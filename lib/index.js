/**
 * Isolation Pod — host half (persistent).
 *
 * Runs isolated tasks in their own Agent session, outside the main session,
 * confined to a user-specified sandbox root.
 *
 * Targets DSH 0.1.7 (the build shipping in the Desktop app); the two surfaces
 * it serves — `dsh web` and the Desktop shell — share one profile patch, one
 * loopback HTTP host and one set of plugin APIs. What that costs here:
 *   - `ctx.shell.execute(spec)` + `handle.result()` is the 0.1.x shell entry
 *     point (`shell.run` was the older one; both are probed at activation).
 *   - The panel's bearer token travels as a structured index-injection row,
 *     because the Desktop page is served by Electron and never passes through
 *     `webServer.renderIndex()` where `tapIndex` transforms would run.
 *   - `MessageSource` is the closed union `user | model | tool | system-prompt`.
 *
 * Only `node:*` imports are allowed: this package lives outside the dsh
 * install, so bare specifiers would not resolve.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-isolation-pod'

export const inject = ['webServer', 'timer', 'fs', 'shell', 'agents', 'sessions', 'sandboxPolicy']

/*
 * Seed for the panel's tool picker.
 *
 * This is NOT the authority on what a pod may call: the authoritative surface
 * is the pod agent's own tool registry (captured per task as `availableTools`)
 * plus every pod session's `request/header`. Names below are DSH 0.1.7's
 * shipped tool surface; `bash` is kept for non-Windows deployments, where the
 * shell tools swap places with `pwsh`.
 */
const KNOWN_TOOLS = [
  'ask_user_question', 'bash', 'cordis_inspect_list', 'cordis_inspect_query', 'create_goal',
  'edit', 'exit_plan_mode', 'get_goal', 'glob', 'grep', 'interrupt_agent', 'job_kill', 'job_list',
  'job_output', 'list_agents', 'load_workspace_dependencies', 'plugin_manager', 'present', 'pwsh',
  'read', 'read_image', 'send_message', 'skill', 'subagent', 'subagent_fork', 'todo_write',
  'update_goal', 'web_fetch', 'web_search', 'workflow', 'write'
]
const DEFAULT_ALLOW = ['pwsh', 'read', 'write', 'edit', 'glob', 'grep']
const BUILD = 8            // bumped on every host-half change; reported by /status
const PLUGIN_VERSION = '0.1.3'
const MAX_AVAILABLE_TOOLS = 80
const MAX_TASKS = 200
const MAX_EXPORTS = 200
const MAX_LOG = 500        // in-memory execution-log entries kept per task
const PERSIST_LOG = 80     // log tail mirrored into isolation-pod.json
const LOG_TEXT_MAX = 400   // per-entry text cap on disk

function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

function statusText(value) {
  if (value === 'completed') return '成功'
  if (value === 'failed') return '失败'
  if (value === 'timeout') return '超时'
  if (value === 'cancelled') return '已取消'
  if (value === 'interrupted') return '已中断'
  if (value === 'running') return '运行中'
  return '排队中'
}

export function apply(ctx) {
  const storePath = join(resolveHome(), 'isolation-pod.json')
  const token = randomUUID()

  const config = {
    sandboxRoot: '',
    allowWrites: true,
    allowedTools: DEFAULT_ALLOW.slice(),
    timeoutMs: 600000,
    readContext: true,
    maxConcurrent: 3,
    enableExport: true,
    allowRememberChoice: false,
    presetId: 'standard'
  }
  const tasks = new Map()
  const handles = new Map()
  const timers = new Map()
  let exports = []
  const observedTools = {}
  for (const tool of KNOWN_TOOLS) observedTools[tool] = true
  const diagnostics = []
  let counter = 0
  let pendingSave = null

  const note = (message) => {
    diagnostics.push({ at: Date.now(), message: String(message) })
    if (diagnostics.length > 50) diagnostics.splice(0, diagnostics.length - 50)
  }

  const str = (value) => (value === undefined || value === null ? '' : String(value))
  const errText = (error) => {
    try { return error && error.message !== undefined ? String(error.message) : String(error) } catch { return 'unprintable' }
  }
  const quote = (value) => "'" + str(value).replace(/'/g, "''") + "'"
  const isAbs = (p) => /^[A-Za-z]:[\\/]/.test(p) || p.indexOf('\\\\') === 0
  /**
   * Canonical spelling of a sandbox root.
   *
   * Trailing separators are load-bearing: the out-of-bounds write probe derives
   * its target from the root's PARENT, and `E:\pod-work\` would put the probe
   * inside the sandbox — where the write succeeds, so the self-check would abort
   * every task. A bare drive root keeps exactly one separator (`E:` alone is the
   * drive's current directory, not its root).
   */
  const normalizeRoot = (p) => {
    let value = str(p).trim().replace(/\//g, '\\')
    if (value === '') return ''
    if (/^[A-Za-z]:$/.test(value)) return value + '\\'
    value = value.replace(/\\+$/, '')
    if (/^[A-Za-z]:$/.test(value)) return value + '\\'
    return value
  }
  const norm = (p) => str(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const isUnder = (p, root) => { const a = norm(p); const b = norm(root); return b !== '' && (a === b || a.indexOf(b + '\\') === 0) }
  const full = () => ({ mode: 'danger-full-access', workspaceRoot: config.sandboxRoot || process.cwd() })
  const nowId = () => { counter += 1; return Date.now().toString(36) + counter.toString(36) }

  // ── persistence ────────────────────────────────────────────────────────────

  const snapshotState = () => ({
    version: 1,
    config: JSON.parse(JSON.stringify(config)),
    tasks: [...tasks.values()].map((task) => ({
      id: task.id, label: task.label, status: task.status, createdAt: task.createdAt,
      startedAt: task.startedAt || 0, endedAt: task.endedAt || 0, subdir: task.subdir,
      taskDir: task.taskDir, childSessionId: task.childSessionId, error: task.error || '',
      turnEndKind: task.turnEndKind || '', finalText: (task.finalText || '').slice(0, 4000),
      contextNote: task.contextNote || '', allow: task.allow || [],
      availableTools: (Array.isArray(task.availableTools) ? task.availableTools : []).slice(0, MAX_AVAILABLE_TOOLS),
      setupNote: str(task.setupNote).slice(0, LOG_TEXT_MAX),
      sandboxMode: task.sandboxCheck ? task.sandboxCheck.mode : '',
      sandboxProbe: task.sandboxCheck ? str(task.sandboxCheck.probe) : '',
      fsDenied: task.sandboxCheck ? !!task.sandboxCheck.fsDenied : false,
      logCount: task.log.length,
      turns: Number(task.turns) || 1,
      log: (task.log || []).slice(-PERSIST_LOG).map((entry) => ({
        seq: Number(entry.seq) || 0, type: str(entry.type), kind: str(entry.kind), time: Number(entry.time) || 0,
        text: str(entry.text).slice(0, LOG_TEXT_MAX), think: str(entry.think).slice(0, LOG_TEXT_MAX)
      }))
    })),
    exports: exports.slice(-MAX_EXPORTS)
  })

  const saveNow = () => {
    try {
      const dir = dirname(storePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const temp = storePath + '.tmp'
      writeFileSync(temp, JSON.stringify(snapshotState(), null, 2), 'utf8')
      renameSync(temp, storePath)
    } catch (error) { note('保存状态失败：' + errText(error)) }
  }

  const scheduleSave = () => {
    if (pendingSave !== null) return
    pendingSave = ctx.timeout(() => { pendingSave = null; saveNow() }, 800)
  }

  const loadState = () => {
    try {
      if (!existsSync(storePath)) return
      const parsed = JSON.parse(readFileSync(storePath, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.config && typeof parsed.config === 'object') {
        for (const key of Object.keys(config)) if (parsed.config[key] !== undefined) config[key] = parsed.config[key]
        // A root persisted by an older spelling (e.g. a trailing separator) must
        // not silently disable the out-of-bounds probe on every later task.
        config.sandboxRoot = normalizeRoot(config.sandboxRoot)
      }
      if (Array.isArray(parsed.tasks)) {
        for (const raw of parsed.tasks.slice(-MAX_TASKS)) {
          if (!raw || typeof raw !== 'object') continue
          // Execution logs are mirrored into the store (bounded tail) so a restart
          // does not erase the visible record; rehydrateLog() can restore the rest
          // from the child session's own persisted log.
          const restoredLog = Array.isArray(raw.log)
            ? raw.log.filter((entry) => entry && typeof entry === 'object').slice(-PERSIST_LOG).map((entry) => ({
                seq: Number(entry.seq) || 0, type: str(entry.type), kind: str(entry.kind), time: Number(entry.time) || 0,
                text: str(entry.text).slice(0, LOG_TEXT_MAX), think: str(entry.think).slice(0, LOG_TEXT_MAX)
              }))
            : []
          const task = {
            id: str(raw.id), label: str(raw.label), status: str(raw.status),
            createdAt: Number(raw.createdAt) || 0, startedAt: Number(raw.startedAt) || 0,
            endedAt: Number(raw.endedAt) || 0, subdir: str(raw.subdir), taskDir: str(raw.taskDir),
            childSessionId: str(raw.childSessionId), error: str(raw.error), turnEndKind: str(raw.turnEndKind),
            finalText: str(raw.finalText), contextNote: str(raw.contextNote),
            allow: Array.isArray(raw.allow) ? raw.allow.map(str) : [],
            availableTools: Array.isArray(raw.availableTools) ? raw.availableTools.map(str).slice(0, MAX_AVAILABLE_TOOLS) : [],
            setupNote: str(raw.setupNote),
            sandboxCheck: { mode: str(raw.sandboxMode), probe: str(raw.sandboxProbe), fsDenied: raw.fsDenied === true, note: '' },
            log: restoredLog, logCount: Math.max(Number(raw.logCount) || 0, restoredLog.length),
            turns: Math.max(1, Number(raw.turns) || 1),
            logTried: restoredLog.length > 0, timedOut: false, mainSessionId: '', description: str(raw.label)
          }
          // A task that was running when the process died can never finish: its Agent is gone.
          if (task.status === 'running' || task.status === 'queued') {
            task.status = 'interrupted'
            if (task.error === '') task.error = '进程重启，任务已中断'
          }
          if (task.id !== '') tasks.set(task.id, task)
        }
      }
      if (Array.isArray(parsed.exports)) exports = parsed.exports.slice(-MAX_EXPORTS)
      note('已从 ' + storePath + ' 恢复 ' + tasks.size + ' 条任务记录')
    } catch (error) { note('读取状态失败（已使用默认配置）：' + errText(error)) }
  }

  // ── child-session event log ────────────────────────────────────────────────
  const blocksText = (blocks) => {
    let out = ''
    try {
      if (!blocks || !blocks.length) return ''
      for (const block of blocks) {
        if (!block) continue
        if (block.type === 'text') out += str(block.text)
        else if (block.content && block.content.length) out += blocksText(block.content)
      }
    } catch { return out }
    return out
  }

  /** Model-visible thinking (`reasoning` blocks), which blocksText deliberately skips. */
  const blocksReasoning = (blocks) => {
    let out = ''
    try {
      if (!blocks || !blocks.length) return ''
      for (const block of blocks) {
        if (!block) continue
        if (block.type === 'reasoning') out += str(block.text)
      }
    } catch { return out }
    return out
  }

  /**
   * Fold one session event into a transcript entry.
   *
   * `kind` is what the panel renders by ('user' | 'prompt' | 'assistant' | 'think'
   * | 'tool' | 'turn'); `think` carries the reasoning that accompanies an answer.
   */
  const summarize = (event) => {
    try {
      const type = str(event.type)
      const data = event.data
      const seq = Number(event.seq)
      const time = Number(event.time)
      if (type === 'user/message') {
        const text = blocksText(data.content).slice(0, 4000)
        if (text === '') return null
        // The first turn's message is the machine-built prompt, not something the
        // user typed; the panel shows it collapsed as a task brief.
        return { seq, type, time, kind: text.startsWith('【隔离舱任务】') ? 'prompt' : 'user', text }
      }
      if (type === 'assistant/message') {
        const content = data.message && data.message.content
        const text = blocksText(content).slice(0, 4000)
        const think = blocksReasoning(content).slice(0, 4000)
        if (text === '' && think === '') return null
        return { seq, type, time, kind: 'assistant', text, think }
      }
      if (type === 'tool/call') return { seq, type, time, kind: 'tool', text: str(data.name) + ' ' + str(data.arguments).slice(0, 500) }
      if (type === 'tool/result') {
        const code = data.error ? str(data.error.code || data.error.name) : ''
        const body = data.message ? blocksText(data.message.content) : ''
        return { seq, type, time, kind: 'tool', text: (code === '' ? '' : '[' + code + '] ') + body.slice(0, 800) }
      }
      if (type === 'turn/start') return { seq, type, time, kind: 'turn', text: '第 ' + str(data.turn) + ' 轮开始' }
      if (type === 'turn/end') return { seq, type, time, kind: 'turn', text: '第 ' + str(data.turn) + ' 轮结束：' + str(data.reason && data.reason.kind) }
      return null
    } catch { return null }
  }

  const findBySession = (sessionId) => {
    for (const task of tasks.values()) if (task.childSessionId === sessionId) return task
    return null
  }

  /**
   * Rebuild a task's execution log from its child session's own persisted log.
   *
   * The in-memory feed only sees events while the process lives, so a task that
   * outlives a restart would otherwise show an empty record. The child session is
   * durable on disk, so read it back through sessionQuery and re-summarize.
   */
  const rehydrateLog = async (task) => {
    if (task.logTried || task.log.length > 0) return
    // A live task still feeds this log through session/event; only a settled task
    // needs the persisted record read back.
    if (task.status === 'running' || task.status === 'queued') return
    task.logTried = true
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery === undefined || task.childSessionId === '') return
    try {
      const snapshot = await sessionQuery.readSession(task.childSessionId)
      const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
      for (const event of events) {
        const entry = summarize(event)
        if (entry !== null) task.log.push(entry)
      }
      if (task.log.length > MAX_LOG) task.log.splice(0, task.log.length - MAX_LOG)
      if (task.log.length > 0) {
        task.logCount = Math.max(Number(task.logCount) || 0, task.log.length)
        note('已从子会话日志恢复 ' + task.id + ' 的 ' + task.log.length + ' 条执行记录')
        scheduleSave()
      }
    } catch (error) { note('恢复 ' + task.id + ' 执行记录失败：' + errText(error)) }
  }

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    try {
      const task = findBySession(str(session.id))
      if (task === null) return
      if (str(event.type) === 'request/header') {
        try {
          const list = event.data.header && event.data.header.tools ? event.data.header.tools : []
          const names = []
          for (const tool of list) {
            const name = str(tool && tool.name)
            if (name === '' || names.includes(name)) continue
            names.push(name)
            observedTools[name] = true
          }
          // Authoritative surface: the header lists exactly the tools this pod was
          // offered for the turn. It supersedes the setup-time probe, which cannot
          // see a preset that registers its rows lazily.
          if (names.length > 0) {
            task.availableTools = names.slice(0, MAX_AVAILABLE_TOOLS)
            scheduleSave()
          }
        } catch { /* ignore */ }
      }
      const entry = summarize(event)
      if (entry === null) return
      task.log.push(entry)
      if (task.log.length > MAX_LOG) task.log.splice(0, task.log.length - MAX_LOG)
      if (str(event.type) === 'turn/end') task.turnEndKind = str(event.data.reason && event.data.reason.kind)
    } catch { /* a listener failure must never escape */ }
  }))

  // ── engine ─────────────────────────────────────────────────────────────────

  const effectiveAllow = () => {
    const want = Array.isArray(config.allowedTools) && config.allowedTools.length ? config.allowedTools : DEFAULT_ALLOW
    const out = []
    for (const raw of want) {
      const tool = str(raw)
      if (tool === '') continue
      if (!config.allowWrites && (tool === 'write' || tool === 'edit')) continue
      if (!out.includes(tool)) out.push(tool)
    }
    return out
  }

  /**
   * Names of the tools one pod agent can actually see, in registry order.
   *
   * The scope argument is load-bearing: `schemas(scope)` answers for THAT agent's
   * visible surface, while an omitted scope answers for the global view — and on
   * the Web/Desktop surface the host plane registers almost none of the pod's
   * tools, so the unscoped answer is a set disjoint from every configured tool.
   * (That is how an earlier build left a pod with an empty allowlist.)
   *
   * Display material only: the guard is the authority, and the pod's own
   * `request/header` corrects this list as soon as the first turn is dispatched.
   */
  const surfaceTools = (agentCtx, agent) => {
    try {
      const rows = agentCtx.tools.schemas(agent)
      const out = []
      for (const row of Array.isArray(rows) ? rows : []) {
        const tool = str(row && row.name)
        if (tool !== '' && !out.includes(tool)) out.push(tool)
      }
      return out.slice(0, MAX_AVAILABLE_TOOLS)
    } catch { return [] }
  }

  /**
   * One user message in the shape 0.1.x's message model accepts.
   *
   * `MessageSource` is the closed union `user | model | tool | system-prompt`,
   * so the plugin-tagged source the earlier build tolerated is an invalid value
   * now; a pod turn IS an ordinary user message and is tagged as one.
   */
  const podUserMessage = (id, text) => ({
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' }
  })

  const captureFinalText = (handle) => {
    try {
      const messages = handle.agent.session.deriveMessages()
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (str(messages[i].role) === 'assistant') {
          const text = blocksText(messages[i].content).trim()
          if (text !== '') return text.slice(0, 4000)
        }
      }
    } catch { return '' }
    return ''
  }

  const readMainContext = async (mainSessionId) => {
    const sessionQuery = ctx.get('sessionQuery')
    if (!config.readContext || mainSessionId === '' || sessionQuery === undefined) return { text: '', note: '未读取主会话上下文' }
    try {
      const snapshot = await sessionQuery.readSurface(mainSessionId)
      const events = snapshot && snapshot.events ? snapshot.events : []
      const picked = []
      for (let i = events.length - 1; i >= 0 && picked.length < 12; i -= 1) {
        const type = str(events[i].type)
        if (type === 'user/message') {
          const text = blocksText(events[i].data.content).trim()
          if (text !== '') picked.push('用户：' + text.slice(0, 700))
        } else if (type === 'assistant/message') {
          const text = blocksText(events[i].data.message && events[i].data.message.content).trim()
          if (text !== '') picked.push('助手：' + text.slice(0, 900))
        }
      }
      picked.reverse()
      let text = picked.join('\n\n')
      if (text.length > 12000) text = text.slice(text.length - 12000)
      return { text, note: picked.length + ' 条上下文' }
    } catch (error) { return { text: '', note: '读取失败：' + errText(error) } }
  }

  const buildPrompt = (task, contextText) => {
    const lines = []
    lines.push('【隔离舱任务】')
    lines.push('任务描述：' + task.description)
    lines.push('沙箱根目录（唯一可写位置，外部一律只读）：' + config.sandboxRoot)
    lines.push('本次输出目录（请在第一步切入）：' + task.taskDir)
    lines.push('可用工具（其它工具已被拒绝）：' + task.allow.join(', '))
    lines.push('要求：所有生成物写在输出目录内；临时文件也写在沙箱内；完成后只给一段不超过 200 字的结论，不要输出完整代码或日志。')
    if (contextText !== '') { lines.push(''); lines.push('【主会话上下文（只读，仅用于理解背景）】'); lines.push(contextText) }
    return lines.join('\n')
  }

  const guardFor = (task) => (execution) => {
    try {
      // Read `task.allow` on EVERY call: the guard is installed during setup and
      // the allowlist is finalized right after the preset mounts, so a captured
      // copy would drift from what the pod was actually granted.
      const allow = Array.isArray(task.allow) ? task.allow : []
      const tool = execution && execution.name ? str(execution.name) : ''
      if (!allow.includes(tool)) return '隔离舱：工具 ' + tool + ' 未被授权，隔离环境不得调用。'
      if (tool === 'write' || tool === 'edit') {
        const args = execution.arguments
        const target = args ? str(args.file_path !== undefined ? args.file_path : args.path) : ''
        if (target !== '' && isAbs(target) && !isUnder(target, config.sandboxRoot)) {
          return '隔离舱：' + tool + ' 目标在沙箱目录之外，已拒绝：' + target
        }
      }
      return undefined
    } catch { return '隔离舱：工具调用被沙箱规则拒绝。' }
  }

  const sandboxSelfTest = async (session) => {
    const result = { mode: '', root: '', fsDenied: false, probe: '', note: '' }
    try {
      const policy = ctx.sandboxPolicy.resolve({ session })
      result.mode = str(policy.mode)
      result.root = str(policy.workspaceRoot)
      const want = config.allowWrites ? 'workspace-write' : 'read-only'
      if (result.mode !== want) { result.probe = 'mode-mismatch'; result.note = '策略模式不符（期望 ' + want + '）'; return result }
      const root = normalizeRoot(config.sandboxRoot)
      const parent = normalizeRoot(root.replace(/[\\/][^\\/]*$/, ''))
      // A drive root has no parent outside itself; there is nothing to probe that
      // is not already writable, so the pre-flight is skipped. The file sandbox
      // still denies out-of-bounds writes at call time — the probe is a proof,
      // not the enforcement.
      if (parent === '' || parent === root) { result.probe = 'skipped-no-parent'; return result }
      const probePath = parent.replace(/\\+$/, '') + '\\__ipp_probe_' + nowId() + '.txt'
      try {
        await ctx.fs.writeText(await ctx.fs.resolve(probePath), 'probe', { kind: 'createIfAbsent' }, undefined, policy)
        result.probe = 'allowed'
        result.note = '越界写入未被拒绝，已中止任务'
        try { await runFull('Remove-Item -LiteralPath ' + quote(probePath) + ' -Force -ErrorAction SilentlyContinue; exit 0', parent, 30000) } catch { /* ignore */ }
        return result
      } catch (error) {
        const code = error && error.code ? str(error.code) : ''
        const message = errText(error)
        if (code === 'FS_SANDBOX_DENIED' || message.indexOf('file access denied') >= 0) {
          result.fsDenied = true
          result.probe = 'denied'
        } else {
          result.probe = 'ambiguous'
          result.note = '越界探测结果不明确：' + message.slice(0, 160)
        }
      }
    } catch (error) {
      result.probe = 'failed'
      result.note = '沙箱自检失败：' + errText(error)
    }
    return result
  }

  /**
   * Which shell entry point this DSH build exposes, probed once at activation.
   *
   * 0.1.x ships `ctx.shell.execute(spec)` returning a process handle whose
   * `result()` is the settled run result; older builds returned that result
   * straight from `ctx.shell.run(spec)`. Probing here means a build mismatch is
   * reported by /status instead of failing at the first directory creation.
   */
  const shellApi = (() => {
    try {
      if (typeof ctx.shell.execute === 'function') return 'execute'
      if (typeof ctx.shell.run === 'function') return 'run'
    } catch { /* an unreadable shell service is reported as missing */ }
    return 'missing'
  })()

  const runFull = async (command, workdir, timeoutMs) => {
    const spec = ctx.shell.resolve({ command, workdir, timeoutMs, stdoutMaxBytes: 64000, sandboxPolicy: full() })
    try {
      if (shellApi === 'run') return await ctx.shell.run(spec)
      // 0.1.x exposes `execute(spec)` → a process handle whose `result()` carries
      // the settled ShellRunResult the callers below consume.
      const handle = await ctx.shell.execute(spec)
      return await handle.result()
    } catch (error) {
      // `execute` rejects for preparation failures, `result()` for infrastructure
      // failures. Callers only ever read the result shape, so report the failure
      // as a failed run instead of unwinding the whole task.
      return {
        exitCode: -1, timedOut: false, aborted: false,
        stdout: { text: '', truncated: false },
        stderr: { text: errText(error), truncated: false }
      }
    }
  }

  const runTask = async (task) => {
    let handle = null
    let prompt = ''
    try {
      const context = await readMainContext(task.mainSessionId)
      task.contextNote = context.note
      const requested = effectiveAllow()
      task.allow = requested
      task.status = 'running'
      task.startedAt = Date.now()
      scheduleSave()

      let agentOptions
      try {
        const model = ctx.get('agentDefaultModel')
        const selection = model ? model.currentSelection() : null
        if (selection) {
          agentOptions = {
            provider: str(selection.provider),
            model: str(selection.model),
            ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }
          }
        }
      } catch { agentOptions = undefined }

      handle = await ctx.agents.create({
        sessionId: task.childSessionId,
        meta: { cwd: config.sandboxRoot, origin: 'subagent' },
        agentOptions,
        setup: async (agentCtx, agent) => {
          agent.session.append('sandbox/mode', { mode: config.allowWrites ? 'workspace-write' : 'read-only', source: 'delegation' })
          agent.session.append('approval/policy', { policy: 'never', source: 'delegation' })
          if (config.presetId !== '') {
            const presets = ctx.get('agentPresets')
            if (presets) { try { await presets.mount(agentCtx, config.presetId) } catch (error) { task.setupNote = 'preset 挂载失败：' + errText(error) } }
          }
          // The preset is bound as an ancestor layer of this agent's scope, so
          // asking for THIS agent's surface lists the tools the preset supplies.
          // `task.allow` keeps the configured allowlist as an upper bound — the
          // guard enforces it, and it is never narrowed here: an empty surface
          // must not be able to leave the pod with nothing to call.
          task.availableTools = surfaceTools(agentCtx, agent)
          agentCtx.tools.guard(guardFor(task))
          agentCtx.systemPrompt.section({
            name: 'isolation-pod/rules',
            order: 900,
            text: 'ISOLATION POD（隔离舱）：你是运行在主会话之外的隔离执行环境。唯一可写位置是 ' + config.sandboxRoot + '，其余路径一律只读，越界写入会被系统强制拒绝。只能使用这些工具：' + task.allow.join(', ') + '，其它工具会被拒绝。所有输出写入 ' + task.taskDir + '。'
          })
        }
      })
      handles.set(task.id, handle)

      const check = await sandboxSelfTest(handle.agent.session)
      task.sandboxCheck = check
      if (check.note !== '' && !check.fsDenied) {
        task.status = 'failed'
        task.error = '沙箱自检未通过：' + check.note
        task.endedAt = Date.now()
        try { await handle.dispose() } catch { /* ignore */ }
        handles.delete(task.id)
        return
      }

      // Best effort only: `restrict` cannot remove scoped registrations, so the
      // guard above remains the authoritative allowlist. It also rejects names
      // this deployment does not register (an unknown global tool throws), so
      // restrict exactly what the pod surface exposes.
      try {
        const surface = Array.isArray(task.availableTools) ? task.availableTools : []
        const restrictTo = task.allow.filter((tool) => surface.includes(tool))
        if (restrictTo.length > 0) handle.agent.ctx.tools.restrict({ allow: restrictTo })
      } catch { /* ignore */ }

      prompt = buildPrompt(task, context.text)
    } catch (error) {
      task.status = 'failed'
      task.error = errText(error)
      task.endedAt = Date.now()
      scheduleSave()
      return
    }
    await runTurn(task, handle, prompt)
  }

  /**
   * Send one user turn into an existing pod agent and wait for it to settle.
   *
   * Used both for a task's first turn and for every follow-up, so a continued
   * conversation runs under exactly the isolation already installed on that
   * agent (sandbox mode, approval policy, tool guard, system prompt).
   */
  const runTurn = async (task, handle, text) => {
    const stop = ctx.timeout(() => {
      task.timedOut = true
      try { handle.agent.cancel({ kind: 'hook', reason: '隔离舱：任务超时' }) } catch { /* ignore */ }
    }, config.timeoutMs)
    timers.set(task.id, stop)

    try {
      await handle.agent.whenIdle()
      handle.agent.followup(podUserMessage('ipp-' + task.id + '-t' + String(Number(task.turns) || 1), text))
      await handle.agent.whenIdle()

      task.finalText = captureFinalText(handle)
      if (task.status === 'running') {
        if (task.timedOut) { task.status = 'timeout'; task.error = '任务超时（' + Math.round(config.timeoutMs / 1000) + ' 秒）' }
        else if (task.turnEndKind === 'error') task.status = 'failed'
        else if (task.turnEndKind === 'aborted') task.status = 'cancelled'
        else task.status = 'completed'
      }
      if (task.status === 'failed' && task.error === '') task.error = '回合结束原因：' + str(task.turnEndKind)
    } catch (error) {
      task.status = 'failed'
      task.error = errText(error)
    } finally {
      task.endedAt = Date.now()
      const pending = timers.get(task.id)
      if (pending) { try { pending() } catch { /* ignore */ } timers.delete(task.id) }
      try { await ctx.sessions.flush(handle.agent.session) } catch { /* ignore */ }
      scheduleSave()
    }
  }

  // ── file inventory ─────────────────────────────────────────────────────────

  const walkDir = async (dirTarget, base, out, depth) => {
    if (depth > 6 || out.length > 1500) return
    let entries = []
    try { entries = await ctx.fs.listDir(dirTarget) } catch { return }
    for (const entry of entries) {
      if (str(entry.name) === '.isolation-pod') continue
      const rel = base === '' ? str(entry.name) : base + '/' + str(entry.name)
      out.push({ relPath: rel, type: str(entry.type), size: entry.size === undefined || entry.size === null ? null : Number(entry.size) })
      if (str(entry.type) === 'directory') await walkDir(entry.target, rel, out, depth + 1)
    }
  }

  const readTaskFile = async (task, rel) => {
    const absPath = task.taskDir.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\')
    const target = await ctx.fs.resolve(absPath)
    const rootTarget = await ctx.fs.resolve(config.sandboxRoot)
    if (!ctx.fs.contains(rootTarget, target)) return null
    const info = await ctx.fs.stat(target)
    if (info === undefined || str(info.type) !== 'file') return null
    return await ctx.fs.readText(target)
  }

  // ── export ─────────────────────────────────────────────────────────────────

  const exportScript = (items, targetDir, mode, conflict) => {
    const lines = []
    lines.push("$ErrorActionPreference = 'Stop'")
    lines.push('New-Item -Path ' + quote(targetDir) + ' -ItemType Directory -Force | Out-Null')
    lines.push('foreach ($s in @(' + items.map((item) => quote(item)).join(',') + ')) {')
    lines.push('  $leaf = Split-Path -Leaf $s')
    lines.push('  $t = Join-Path ' + quote(targetDir) + ' $leaf')
    lines.push('  if (Test-Path -Path $t) {')
    if (conflict === 'skip') lines.push("    Write-Output ('##IPP##SKIP##' + $s + '##' + $t); continue")
    else if (conflict === 'rename') {
      lines.push('    $base = [System.IO.Path]::GetFileNameWithoutExtension($leaf)')
      lines.push('    $ext = [System.IO.Path]::GetExtension($leaf)')
      lines.push('    $dir = Split-Path -Parent $t')
      lines.push('    $i = 1')
      lines.push('    while (Test-Path -Path $t) { $t = (Join-Path $dir ($base + "-" + $i + $ext)); $i = $i + 1 }')
    }
    lines.push('  }')
    lines.push('  try {')
    if (mode === 'move') lines.push('    Move-Item -LiteralPath $s -Destination $t -Force')
    else lines.push('    Copy-Item -LiteralPath $s -Destination $t -Recurse -Force')
    lines.push("    Write-Output ('##IPP##OK##' + $s + '##' + $t)")
    lines.push('  } catch {')
    lines.push("    Write-Output ('##IPP##FAIL##' + $s + '##' + $t + '##' + $_.Exception.Message)")
    lines.push('  }')
    lines.push('}')
    lines.push("Write-Output '##IPP##END'")
    return lines.join('\n')
  }

  const parseMarkers = (out) => {
    const rows = []
    for (const line of str(out).split(/\r?\n/)) {
      if (line.indexOf('##IPP##') !== 0) continue
      const segments = line.split('##')
      if (segments.length < 4 || segments[2] === 'END') continue
      rows.push({ status: str(segments[2]), src: str(segments[3]), dst: str(segments[4]), message: str(segments[5]) })
    }
    return rows
  }

  // ── task projections ───────────────────────────────────────────────────────

  const taskSummary = (task) => ({
    id: task.id, label: task.label, description: task.description || task.label, status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt || 0, endedAt: task.endedAt || 0, subdir: task.subdir,
    taskDir: task.taskDir, childSessionId: task.childSessionId, error: task.error || '',
    turnEndKind: task.turnEndKind || '', finalText: (task.finalText || '').slice(0, 600),
    contextNote: task.contextNote || '', allow: task.allow || [],
    availableTools: Array.isArray(task.availableTools) ? task.availableTools : [],
    setupNote: task.setupNote || '',
    logCount: task.log.length,
    turns: Number(task.turns) || 1,
    // Continuation is process-lifetime only: the child agent is what holds the
    // live conversation, so after a restart the history is readable but frozen.
    canFollowUp: handles.has(task.id),
    sandboxMode: task.sandboxCheck ? task.sandboxCheck.mode : '',
    sandboxProbe: task.sandboxCheck ? str(task.sandboxCheck.probe) : '',
    fsDenied: task.sandboxCheck ? !!task.sandboxCheck.fsDenied : false
  })

  // ── RPC methods ────────────────────────────────────────────────────────────

  /**
   * Cwd of one live user session, or '' when it is not live or not a user session.
   *
   * The warning this feeds is about the workspace the user is looking at RIGHT
   * NOW, so it must be answered for one named session: scanning every session
   * would fire whenever some unrelated session happens to sit inside the sandbox.
   * Pod sessions (delegation origin, or one this plugin created) never count.
   */
  const userSessionCwd = (sessionId) => {
    if (sessionId === '') return ''
    const own = new Set([...tasks.values()].map((task) => task.childSessionId))
    try {
      for (const session of ctx.sessions.list()) {
        const header = session ? session.header : undefined
        if (!header) continue
        const id = str(header.id)
        if (id !== sessionId) continue
        if (str(header.origin) === 'subagent' || own.has(id)) return ''
        return str(header.cwd)
      }
    } catch { /* a listing failure must not break the panel */ }
    return ''
  }

  const sandboxCheck = (sessionId) => {
    const cwd = userSessionCwd(sessionId)
    const known = cwd !== '' && config.sandboxRoot !== '' && isAbs(config.sandboxRoot)
    return { cwd, known, inside: known ? isUnder(config.sandboxRoot, cwd) : false }
  }

  /**
   * Preset roster for the config page's picker.
   *
   * On the Web/Desktop surface the preset is what supplies a pod's tools, so
   * picking one from the roster beats typing an id blind. A deployment without
   * the registry yields an empty roster and the panel falls back to free text.
   */
  const presetChoices = async () => {
    try {
      const presets = ctx.get('agentPresets')
      if (presets === undefined) return []
      const rows = await presets.list()
      const out = []
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = str(row && row.id)
        if (id === '') continue
        out.push({ id, name: str(row && row.name), broken: str(row && row.broken) })
      }
      return out
    } catch { return [] }
  }

  const methods = {
    async getState(args) {
      const list = [...tasks.values()].map(taskSummary).sort((a, b) => b.createdAt - a.createdAt)
      let rootExists = false
      if (config.sandboxRoot !== '' && isAbs(config.sandboxRoot)) {
        try { rootExists = (await ctx.fs.stat(await ctx.fs.resolve(config.sandboxRoot))) !== undefined } catch { rootExists = false }
      }
      const verdict = sandboxCheck(str(args && args.mainSessionId))
      return {
        ok: true,
        pluginVersion: PLUGIN_VERSION,
        config: { ...config, allowedTools: effectiveAllow() },
        toolChoices: Object.keys(observedTools).sort(),
        presetChoices: await presetChoices(),
        sandbox: {
          set: config.sandboxRoot !== '', root: config.sandboxRoot, exists: rootExists,
          insideMainCwd: verdict.inside, mainCwd: verdict.cwd, cwdKnown: verdict.known
        },
        tasks: list,
        exports: exports.slice(-50).reverse(),
        diagnostics: diagnostics.slice(-20),
        storePath
      }
    },

    async setConfig(args) {
      const patch = args.patch && typeof args.patch === 'object' ? args.patch : {}
      const messages = []
      if (patch.sandboxRoot !== undefined) {
        const value = normalizeRoot(patch.sandboxRoot)
        if (value !== '' && !isAbs(value)) return { ok: false, message: '沙箱根目录必须是绝对路径。' }
        config.sandboxRoot = value
      }
      if (patch.allowWrites !== undefined) config.allowWrites = !!patch.allowWrites
      if (patch.timeoutMs !== undefined) {
        const value = Number(patch.timeoutMs)
        config.timeoutMs = Math.max(30000, Math.min(7200000, Number.isFinite(value) ? value : 600000))
      }
      if (patch.readContext !== undefined) config.readContext = !!patch.readContext
      if (patch.maxConcurrent !== undefined) {
        const value = Number(patch.maxConcurrent)
        config.maxConcurrent = Math.max(1, Math.min(8, Number.isFinite(value) ? value : 3))
      }
      if (patch.enableExport !== undefined) config.enableExport = !!patch.enableExport
      if (patch.allowRememberChoice !== undefined) config.allowRememberChoice = !!patch.allowRememberChoice
      if (patch.presetId !== undefined) config.presetId = str(patch.presetId)
      if (patch.allowedTools !== undefined && Array.isArray(patch.allowedTools)) {
        const keep = []
        for (const raw of patch.allowedTools) {
          const tool = str(raw)
          if (tool !== '' && observedTools[tool] && !keep.includes(tool)) keep.push(tool)
        }
        if (keep.length === 0) messages.push('工具白名单不能为空，已保留原设置')
        else config.allowedTools = keep
      }
      saveNow()
      return { ok: true, messages }
    },

    async startTask(args) {
      const mainSessionId = str(args.mainSessionId)
      const description = str(args.description).trim()
      const subdir = str(args.subdir).trim()
      if (config.sandboxRoot === '') return { ok: false, code: 'NO_SANDBOX_ROOT', message: '请先在「配置」中指定沙箱根目录，再启动任务。' }
      if (!isAbs(config.sandboxRoot)) return { ok: false, code: 'BAD_ROOT', message: '沙箱根目录必须是绝对路径。' }
      if (description === '') return { ok: false, code: 'NO_TASK', message: '请填写任务描述。' }
      if (subdir !== '' && !/^[^\\/:*?"<>|]+$/.test(subdir)) return { ok: false, code: 'BAD_SUBDIR', message: '子目录名不能包含 \\ / : * ? " < > |' }
      const running = [...tasks.values()].filter((task) => task.status === 'running').length
      if (running >= config.maxConcurrent) return { ok: false, code: 'BUSY', message: '并发任务已达上限 ' + config.maxConcurrent + '，请先等待或取消。' }

      const id = 'pod-' + nowId()
      const taskDir = config.sandboxRoot.replace(/[\\/]+$/, '') + '\\' + (subdir !== '' ? subdir : id)
      const task = {
        id, childSessionId: 'pod-session-' + id, mainSessionId, description,
        label: description.replace(/\s+/g, ' ').slice(0, 40), subdir, taskDir,
        status: 'queued', createdAt: Date.now(), startedAt: 0, endedAt: 0, log: [], turns: 1,
        allow: effectiveAllow(), finalText: '', error: '', turnEndKind: '', contextNote: '',
        sandboxCheck: null, timedOut: false
      }
      try {
        await runFull(
          'New-Item -Path ' + quote(config.sandboxRoot) + ' -ItemType Directory -Force | Out-Null; New-Item -Path ' + quote(taskDir) + ' -ItemType Directory -Force | Out-Null; Write-Output ok',
          undefined, 60000
        )
      } catch (error) { return { ok: false, code: 'MKDIR', message: '创建沙箱目录失败：' + errText(error) } }

      tasks.set(id, task)
      while (tasks.size > MAX_TASKS) { const oldest = tasks.keys().next().value; if (oldest === id) break; tasks.delete(oldest) }
      saveNow()
      runTask(task).catch((error) => {
        task.status = 'failed'
        task.error = errText(error)
        task.endedAt = Date.now()
        scheduleSave()
      })
      return { ok: true, taskId: id }
    },

    async getTask(args) {
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      await rehydrateLog(task)
      const from = Math.max(0, Number(args.fromLogIndex) || 0)
      return { ok: true, task: taskSummary(task), log: task.log.slice(from).slice(-300), logIndex: task.log.length, running: task.status === 'running' }
    },

    async cancelTask(args) {
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      const handle = handles.get(task.id)
      if (handle) { try { handle.agent.cancel({ kind: 'hook', reason: '隔离舱：用户取消' }) } catch (error) { return { ok: false, message: errText(error) } } }
      if (task.status === 'running') task.status = 'cancelled'
      if (task.endedAt === 0) task.endedAt = Date.now()
      scheduleSave()
      return { ok: true }
    },

    /**
     * Continue an existing pod conversation with one more user turn.
     *
     * The child agent is kept alive for the lifetime of this process, so a
     * follow-up reuses the very same session, sandbox, guard and system prompt —
     * there is nothing to re-install and no way for the isolation to drift.
     */
    async followUp(args) {
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      const text = str(args.text).trim()
      if (text === '') return { ok: false, message: '内容为空，已取消。' }
      const handle = handles.get(task.id)
      if (handle === undefined) {
        return {
          ok: false, code: 'GONE',
          message: '这个任务的隔离会话已随进程结束，无法继续对话（历史仍可查看）。请到「新建」开一个新任务。'
        }
      }
      if (task.status === 'running') return { ok: false, message: '上一轮还在运行，请等它结束或点「停止」。' }
      task.turns = (Number(task.turns) || 1) + 1
      task.status = 'running'
      task.endedAt = 0
      task.error = ''
      task.turnEndKind = ''
      task.timedOut = false
      task.startedAt = Date.now()
      scheduleSave()
      runTurn(task, handle, text).catch((error) => {
        task.status = 'failed'
        task.error = errText(error)
        task.endedAt = Date.now()
        scheduleSave()
      })
      return { ok: true, taskId: task.id, turn: task.turns }
    },

    async listFiles(args) {
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      const rootTarget = await ctx.fs.resolve(config.sandboxRoot)
      const dirTarget = await ctx.fs.resolve(task.taskDir)
      if (!ctx.fs.contains(rootTarget, dirTarget)) return { ok: false, message: '任务目录不在沙箱内' }
      const out = []
      await walkDir(dirTarget, '', out, 0)
      return { ok: true, root: task.taskDir, entries: out, truncated: out.length > 1500 }
    },

    async readSandboxFile(args) {
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      const rel = str(args.relPath)
      if (rel === '' || rel.indexOf('..') >= 0) return { ok: false, message: '路径不合法' }
      const target = await ctx.fs.resolve(task.taskDir.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\'))
      const rootTarget = await ctx.fs.resolve(config.sandboxRoot)
      if (!ctx.fs.contains(rootTarget, target)) return { ok: false, message: '目标不在沙箱目录内' }
      const info = await ctx.fs.stat(target)
      if (info === undefined) return { ok: false, message: '文件不存在' }
      if (str(info.type) !== 'file') return { ok: false, message: '不是普通文件' }
      const size = info.size === undefined ? 0 : Number(info.size)
      if (size > 300000) return { ok: false, message: '文件过大（>300KB）' }
      const raw = await ctx.fs.readText(target)
      const max = Math.max(200, Math.min(20000, Number(args.maxChars) || 4000))
      return { ok: true, text: raw.slice(0, max), truncated: raw.length > max, bytes: size }
    },

    async previewReturn(args) {
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      const parts = args.parts && typeof args.parts === 'object' ? args.parts : {}
      const lines = []
      lines.push('【隔离舱返回】' + task.label)
      if (parts.status !== false) lines.push('状态：' + statusText(task.status) + (task.error ? '（' + task.error.slice(0, 120) + '）' : ''))
      if (parts.conclusion !== false) {
        const conclusion = str(task.finalText).trim()
        lines.push(conclusion === '' ? '结论：（隔离环境没有产生文本结论）' : '结论：' + conclusion)
      }
      if (parts.file && parts.file.relPath) {
        const rel = str(parts.file.relPath)
        try {
          const raw = await readTaskFile(task, rel)
          if (raw === null) lines.push('文件 ' + rel + '：（不可读或不在沙箱内）')
          else lines.push('文件 ' + rel + ' 内容：' + raw.slice(0, 1500) + (raw.length > 1500 ? ' …（已截断）' : ''))
        } catch (error) { lines.push('文件 ' + rel + ' 读取失败：' + errText(error)) }
      }
      if (parts.customText) lines.push('补充：' + str(parts.customText).slice(0, 1000))
      let text = lines.join('\n')
      const cap = 4000
      const truncated = text.length > cap
      if (truncated) text = text.slice(0, cap) + '\n…（已截断）'
      return { ok: true, text, truncated }
    },

    async returnToMain(args) {
      const mainSessionId = str(args.mainSessionId)
      const text = str(args.text).trim()
      if (mainSessionId === '') return { ok: false, message: '未定位到主会话' }
      if (text === '') return { ok: false, message: '返回内容为空，已取消。' }
      const agent = ctx.agents.get(mainSessionId)
      if (agent === undefined) return { ok: false, message: '主会话当前未打开，无法返回。' }
      agent.followup(podUserMessage('ipp-ret-' + nowId(), text.slice(0, 8000)))
      return { ok: true, message: '已返回主会话' }
    },

    async exportEntries(args) {
      if (!config.enableExport) return { ok: false, message: '导出功能已在配置中关闭。' }
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      const targetDir = str(args.targetDir).trim()
      if (targetDir === '' || !isAbs(targetDir)) return { ok: false, message: '请指定绝对路径作为导出目标目录。' }
      if (isUnder(targetDir, config.sandboxRoot)) return { ok: false, message: '导出目标不能位于沙箱目录内。' }
      if (args.remember === true && !config.allowRememberChoice) return { ok: false, message: '「记住本次选择」未在配置中启用。' }
      const rels = Array.isArray(args.entries) ? args.entries : []
      if (rels.length === 0) return { ok: false, message: '请至少选择一个文件或目录。' }
      const rootTarget = await ctx.fs.resolve(config.sandboxRoot)
      const items = []
      for (const raw of rels) {
        const rel = str(raw)
        if (rel === '' || rel.indexOf('..') >= 0) continue
        const target = await ctx.fs.resolve(task.taskDir.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\'))
        if (!ctx.fs.contains(rootTarget, target)) continue
        items.push(task.taskDir.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\'))
      }
      if (items.length === 0) return { ok: false, message: '所选条目均不在沙箱内，已取消。' }
      const mode = str(args.mode) === 'move' ? 'move' : 'copy'
      const conflict = ['skip', 'rename', 'overwrite'].includes(str(args.conflict)) ? str(args.conflict) : 'overwrite'
      const result = await runFull(exportScript(items, targetDir, mode, conflict), config.sandboxRoot, 300000)
      const rows = parseMarkers(result.stdout ? result.stdout.text : '')
      const record = {
        id: 'exp-' + nowId(), at: Date.now(), taskId: task.id, label: task.label, targetDir,
        mode, conflict, exitCode: result.exitCode === null ? -1 : Number(result.exitCode),
        items: rows.map((row) => ({ status: row.status, src: row.src, dst: row.dst, message: row.message }))
      }
      exports.push(record)
      if (exports.length > MAX_EXPORTS) exports.splice(0, exports.length - MAX_EXPORTS)
      saveNow()
      return { ok: true, exportId: record.id, items: record.items, stderrTail: str(result.stderr ? result.stderr.text : '').slice(0, 400) }
    },

    async listExports() { return { ok: true, exports: exports.slice().reverse() } },

    async undoExport(args) {
      const id = str(args.exportId)
      let record = null
      for (let i = exports.length - 1; i >= 0; i -= 1) if (exports[i].id === id) { record = exports[i]; break }
      if (record === null) return { ok: false, message: '导出记录不存在' }
      if (record.mode !== 'copy') return { ok: false, message: '「移动」模式的导出不支持撤销。' }
      const targets = record.items.filter((item) => item.status === 'OK' && item.dst).map((item) => item.dst)
      if (targets.length === 0) return { ok: false, message: '没有可撤销的条目。' }
      const lines = ["$ErrorActionPreference = 'SilentlyContinue'"]
      for (const target of targets) {
        lines.push('if (Test-Path -LiteralPath ' + quote(target) + ') { Remove-Item -LiteralPath ' + quote(target) + ' -Recurse -Force }')
        lines.push("Write-Output ('##IPP##UNDO##' + " + quote(target) + ')')
      }
      lines.push("Write-Output '##IPP##END'")
      const result = await runFull(lines.join('\n'), record.targetDir, 120000)
      const rows = parseMarkers(result.stdout ? result.stdout.text : '')
      record.undoneAt = Date.now()
      saveNow()
      return { ok: true, removed: rows.map((row) => row.src) }
    },

    async cleanup(args) {
      const task = tasks.get(str(args.taskId))
      if (task === undefined) return { ok: false, message: '任务不存在' }
      const scope = str(args.scope) === 'files' || str(args.scope) === 'all' ? str(args.scope) : 'record'
      if (scope === 'files' || scope === 'all') {
        const root = config.sandboxRoot.replace(/[\\/]+$/, '')
        const dir = task.taskDir.replace(/[\\/]+$/, '')
        if (norm(dir) === norm(root)) return { ok: false, message: '拒绝删除沙箱根目录本身。' }
        if (!isUnder(dir, root)) return { ok: false, message: '任务目录不在沙箱内，已拒绝。' }
        await runFull('if (Test-Path -LiteralPath ' + quote(dir) + ') { Remove-Item -LiteralPath ' + quote(dir) + ' -Recurse -Force }; Write-Output ok', root, 120000)
      }
      if (scope === 'record' || scope === 'all') {
        const handle = handles.get(task.id)
        if (handle) { try { await handle.dispose() } catch { /* ignore */ } handles.delete(task.id) }
        const stop = timers.get(task.id)
        if (stop) { try { stop() } catch { /* ignore */ } timers.delete(task.id) }
        tasks.delete(task.id)
        saveNow()
      }
      return { ok: true }
    }
  }

  // ── transport ──────────────────────────────────────────────────────────────

  const readBody = (req) => new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => { try { resolve(raw === '' ? {} : JSON.parse(raw)) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })

  const send = (res, code, value) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  ctx.effect(() => {
    try {
      return ctx.webServer.register({
        kind: 'prefix',
        path: '/isolation-pod',
        handler: async (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
          if (pathname === '/isolation-pod/status') {
            // Local diagnostic endpoint: counts and recent notes only, never the
            // bearer token. The API itself is token-gated.
            const liveSessions = []
            try {
              for (const session of ctx.sessions.list()) {
                const header = session ? session.header : undefined
                if (!header) continue
                const cwd = str(header.cwd)
                liveSessions.push({
                  id: str(header.id), origin: str(header.origin), cwd,
                  insideSandbox: cwd !== '' && isAbs(config.sandboxRoot) && isUnder(config.sandboxRoot, cwd)
                })
              }
            } catch { /* diagnostics only */ }
            let hasConnection = false
            try { hasConnection = ctx.get('connection') !== undefined } catch { hasConnection = false }
            send(res, 200, {
              ok: true, build: BUILD, pluginVersion: PLUGIN_VERSION, tokenPrefix: token.slice(0, 8),
              taskCount: tasks.size, storePath,
              sandbox: { root: config.sandboxRoot, liveSessions },
              compat: { shellApi, indexInject: true, bootstrap: hasConnection },
              diagnostics: diagnostics.slice(-20)
            })
            return
          }
          if (pathname === '/isolation-pod/bootstrap') {
            /*
             * Token (re)acquisition for an already-authenticated browser session.
             *
             * The index-injection row only reaches a page as it loads. The
             * Desktop shell has no reload command in release builds, so a client
             * half mounted by the live module-graph push would never see that
             * row; this route hands the token to a caller the harness itself
             * authenticated (the Desktop forwards its host cookie on every
             * dsh-app://app/* request, a Web browser carries the same cookie).
             * Without the connection service the route stays closed and the
             * client half falls back to the served HTML.
             */
            let admitted = false
            try {
              const connection = ctx.get('connection')
              admitted = connection !== undefined && connection.requestRejection(req) === undefined
            } catch { admitted = false }
            if (!admitted) { send(res, 401, { ok: false, message: 'unauthorized' }); return }
            send(res, 200, { ok: true, token })
            return
          }
          if (pathname !== '/isolation-pod/api') { send(res, 404, { ok: false, message: 'not found' }); return }
          if (req.method !== 'POST') { send(res, 405, { ok: false, message: 'POST only' }); return }
          if (req.headers['x-ipp-token'] !== token) { send(res, 403, { ok: false, message: 'bad or missing token' }); return }
          let body = {}
          try { body = await readBody(req) } catch { body = {} }
          const method = str(body.method)
          const fn = methods[method]
          if (typeof fn !== 'function') { send(res, 200, { ok: false, message: 'unknown method: ' + method }); return }
          try {
            send(res, 200, await fn(body.args && typeof body.args === 'object' ? body.args : {}))
          } catch (error) {
            note('方法 ' + method + ' 失败：' + errText(error))
            send(res, 200, { ok: false, message: errText(error) })
          }
        }
      })
    } catch (error) {
      note('注册 HTTP 路由失败：' + errText(error))
      return () => {}
    }
  })

  ctx.effect(() => {
    try {
      // Structured index injection row: the served Web form renders it into the
      // document head, and the Desktop shell ships the SAME rows to its renderer
      // over IPC. A raw `tapIndex` transform would only cover the former — the
      // Desktop page is served by Electron, not by webServer.renderIndex().
      return ctx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'global', name: '__DSH_IPP__', value: { token } })
      })
    } catch (error) {
      note('注册索引注入失败（面板可能取不到令牌）：' + errText(error))
      return () => {}
    }
  })

  ctx.effect(() => () => {
    for (const handle of handles.values()) { try { handle.dispose() } catch { /* ignore */ } }
    handles.clear()
    for (const stop of timers.values()) { try { stop() } catch { /* ignore */ } }
    timers.clear()
    if (pendingSave !== null) { try { pendingSave() } catch { /* ignore */ } pendingSave = null }
    saveNow()
  })

  loadState()
  note('shell API: ' + shellApi)
  console.log('[isolation-pod] v' + PLUGIN_VERSION + ' (build ' + BUILD + ') host half ready; shell=' + shellApi + '; state at ' + storePath)
}
