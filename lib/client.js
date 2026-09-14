/**
 * Isolation Pod — client half (persistent).
 *
 * Hand-written bundle in the format dsh-client-modules expects: it registers
 * under the package name (the graph key is `graphRow(packageName, ...)`) and
 * exports a Cordis client plugin.
 *
 * Entry points:
 *   - sidebar.panellist  → the one sidebar entry (icon + 「隔离舱」 label),
 *     which the shell turns into a real nav row that selects the panel
 *   - main               → the full-width panel body
 *
 * The sidebar foot is deliberately left alone: that row is shared with the
 * shipped Cordis button, and a labelled button there gets squeezed to nothing.
 *
 * RPC is the Package's own HTTP route; the bearer token arrives through
 * window.__DSH_IPP__, injected into index.html by the host half.
 */
window.__ModuleLoader__.load({
	id: 'dsh-isolation-pod',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports

		const React = require('react')
		const h = React.createElement

		const CSS = [
			'.ipp-root{height:100%;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}',
			'.ipp-bar{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}',
			'.ipp-tab{padding:5px 10px;border-radius:8px;cursor:pointer;border:.5px solid transparent;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit}',
			'.ipp-tab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}',
			'.ipp-body{flex:1;overflow:auto;padding:16px}',
			'.ipp-card{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:12px;margin-bottom:12px}',
			'.ipp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}',
			'.ipp-lab{color:var(--dsw-alias-label-secondary);min-width:96px}',
			'.ipp-in,.ipp-ta{background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);padding:6px 8px;font:inherit;flex:1;min-width:180px;box-sizing:border-box}',
			'.ipp-ta{width:100%;min-height:76px;resize:vertical}',
			'.ipp-btn{padding:5px 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit}',
			'.ipp-btn.pri{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
			'.ipp-btn:disabled{opacity:.45;cursor:default}',
			'.ipp-chip{display:inline-block;padding:1px 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);font-size:12px}',
			'.ipp-chip.ok{color:var(--dsw-alias-state-success-primary)}',
			'.ipp-chip.err{color:var(--dsw-alias-state-error-primary)}',
			'.ipp-chip.warn{color:var(--dsw-alias-state-warn-primary)}',
			'.ipp-log{font-family:var(--ds-font-family-code,monospace);font-size:12px;max-height:340px;overflow:auto;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;background:var(--dsw-alias-bg-layer-2)}',
			'.ipp-line{padding:2px 0;border-bottom:.5px dotted var(--dsw-alias-border-l1);white-space:pre-wrap;word-break:break-all}',
			'.ipp-t{color:var(--dsw-alias-label-secondary);margin-right:6px}',
			'.ipp-mut{color:var(--dsw-alias-label-secondary)}',
			'.ipp-warn{border:.5px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);padding:8px 10px;border-radius:8px;margin-bottom:10px}',
			'.ipp-tools{display:flex;flex-wrap:wrap;gap:6px;max-height:200px;overflow:auto}',
			'.ipp-chat{max-height:52vh;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:2px}',
			'.ipp-msg{display:flex;flex-direction:column;gap:4px;max-width:92%}',
			'.ipp-msg.user{align-self:flex-end;align-items:flex-end}',
			'.ipp-msg.bot{align-self:flex-start}',
			'.ipp-who{font-size:11px;color:var(--dsw-alias-label-secondary)}',
			'.ipp-bubble{border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.55}',
			'.ipp-msg.user .ipp-bubble{border-color:var(--dsw-alias-label-secondary)}',
			'.ipp-sep{font-size:11px;color:var(--dsw-alias-label-secondary);text-align:center;border-top:.5px dotted var(--dsw-alias-border-l1);padding-top:6px}',
			'.ipp-tool{font-family:var(--ds-font-family-code,monospace);font-size:12px;display:flex;gap:6px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all}',
			'.ipp-toolname{flex:none}',
			'.ipp-think{border-left:2px solid var(--dsw-alias-border-l1);padding-left:8px;margin-bottom:2px}',
			'.ipp-think summary,.ipp-brief summary{cursor:pointer;font-size:11px;color:var(--dsw-alias-label-secondary)}',
			'.ipp-think .ipp-thinkbody{white-space:pre-wrap;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;line-height:1.5}',
			'.ipp-brief .ipp-briefbody{white-space:pre-wrap;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:6px;max-height:200px;overflow:auto}',
			'.ipp-send{display:flex;flex-direction:column;gap:6px;margin-top:10px}',
			'.ipp-run{font-size:12px;color:var(--dsw-alias-state-warn-primary)}'
		].join('')

		const TABS = [['tasks', '任务'], ['new', '新建'], ['config', '配置'], ['exports', '导出记录']]

		/*
		 * The bearer token is baked into index.html when the page is served, so an
		 * already-open page keeps the PREVIOUS process's token across a dsh restart
		 * and every call comes back 403. Instead of asking the user to reload, pull
		 * the token out of a fresh same-origin index response (it still carries the
		 * web auth cookie) and retry once.
		 */
		let tokenCache = (window.__DSH_IPP__ && window.__DSH_IPP__.token) || ''

		const refreshToken = () => fetch('/', { credentials: 'same-origin', cache: 'no-store' })
			.then((response) => response.text())
			.then((html) => {
				const match = /window\.__DSH_IPP__=(\{[^<]*\})/.exec(html)
				if (!match) return false
				try {
					const parsed = JSON.parse(match[1])
					if (!parsed || typeof parsed.token !== 'string' || parsed.token === '') return false
					tokenCache = parsed.token
					return true
				} catch (error) { return false }
			})
			.catch(() => false)

		const post = (method, args) => fetch('/isolation-pod/api', {
			method: 'POST',
			cache: 'no-store',
			headers: { 'content-type': 'application/json', 'x-ipp-token': tokenCache },
			body: JSON.stringify({ method: method, args: args === undefined ? {} : args })
		})

		const api = (method, args) => post(method, args)
			.then((response) => {
				if (response.status !== 403) return response.json()
				return refreshToken()
					.then((found) => (found ? post(method, args) : null))
					.then((retry) => {
						if (!retry) return { ok: false, message: '页面未注入令牌，请刷新页面' }
						if (retry.status === 403) return { ok: false, message: '令牌已失效，请刷新页面' }
						return retry.json()
					})
			})
			.catch((error) => ({ ok: false, message: String(error) }))

		function Shield(props) {
			const size = props && props.size ? props.size : 18
			return h('svg', {
				width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
				stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round'
			},
				h('path', { d: 'M12 3l7 3v5.4c0 4.2-2.9 7.4-7 9.6-4.1-2.2-7-5.4-7-9.6V6l7-3z' }),
				h('path', { d: 'M9.2 12.3l2 2 3.6-3.9' }))
		}

		function StatusChip(props) {
			const map = {
				completed: ['ok', '成功'], failed: ['err', '失败'], timeout: ['warn', '超时'],
				cancelled: ['warn', '已取消'], interrupted: ['warn', '已中断'],
				running: ['', '运行中'], queued: ['', '排队中']
			}
			const entry = map[props.status] || ['', props.status]
			return h('span', { className: 'ipp-chip ' + entry[0] }, entry[1])
		}

		/** Single entry point: the sidebar's global-panel icon row. */
		function PanelIcon(props) {
			return h(Shield, { size: props && props.size ? props.size : 18 })
		}

		function Panel(props, ctx) {
			const useSessions = props.useSessions
			const currentSessionId = useSessions ? useSessions((state) => state.current) : undefined

			const [tab, setTab] = React.useState('tasks')
			const [state, setState] = React.useState(null)
			const [detailId, setDetailId] = React.useState('')
			const [detail, setDetail] = React.useState(null)
			const [files, setFiles] = React.useState(null)
			const [picked, setPicked] = React.useState({})
			const [toast, setToast] = React.useState('')
			const [error, setError] = React.useState('')
			const [desc, setDesc] = React.useState('')
			const [subdir, setSubdir] = React.useState('')
			const [cfg, setCfg] = React.useState(null)
			const [retPreview, setRetPreview] = React.useState('')
			const [retFile, setRetFile] = React.useState('')
			const [exportDir, setExportDir] = React.useState('')
			const [exportMode, setExportMode] = React.useState('copy')
			const [exportConflict, setExportConflict] = React.useState('overwrite')
			const [remember, setRemember] = React.useState(false)
			const [confirmExport, setConfirmExport] = React.useState(false)
			const [reply, setReply] = React.useState('')
			const [sending, setSending] = React.useState(false)
			const chatRef = React.useRef(null)
			const busy = React.useRef(false)
			const logCursor = React.useRef(0)

			const say = (message) => {
				setToast(String(message === undefined ? '' : message))
				window.setTimeout(() => setToast(''), 4500)
			}

			React.useEffect(() => {
				let alive = true
				const tick = () => {
					if (busy.current) return
					busy.current = true
					// The sandbox-inside-workspace warning is about THIS session's cwd, so
					// the Host has to be told which session the panel is looking at.
					api('getState', { mainSessionId: String(currentSessionId || '') }).then((result) => {
						busy.current = false
						if (!alive) return
						if (result && result.ok) { setState(result); setError('') }
						else setError((result && result.message) || '无法连接隔离舱接口')
					})
				}
				tick()
				const handle = window.setInterval(tick, 2500)
				return () => { alive = false; window.clearInterval(handle) }
			}, [currentSessionId])

			// Keep the newest turn in view while the pod is thinking.
			React.useEffect(() => {
				const box = chatRef.current
				if (box) box.scrollTop = box.scrollHeight
			}, [detail && detail.log ? detail.log.length : 0, detail && detail.task ? detail.task.status : ''])

			React.useEffect(() => {
				if (!detailId) { setDetail(null); return undefined }
				let alive = true
				const tick = () => {
					api('getTask', { taskId: detailId, fromLogIndex: logCursor.current }).then((result) => {
						if (!alive || !result || !result.ok) return
						logCursor.current = result.logIndex
						setDetail((prev) => {
							if (!prev || prev.task.id !== result.task.id) return { task: result.task, log: result.log }
							return { task: result.task, log: prev.log.concat(result.log).slice(-400) }
						})
					})
				}
				tick()
				const handle = window.setInterval(tick, 1500)
				return () => { alive = false; window.clearInterval(handle) }
			}, [detailId])

			React.useEffect(() => {
				if (state && !cfg) setCfg(JSON.parse(JSON.stringify(state.config)))
			}, [state])

			const start = () => {
				if (!currentSessionId) { say('未定位到当前主会话，无法启动'); return }
				api('startTask', { mainSessionId: String(currentSessionId), description: desc, subdir: subdir }).then((result) => {
					if (result && result.ok) {
						say('任务已启动：' + result.taskId)
						setDesc(''); setSubdir(''); setTab('tasks')
						logCursor.current = 0; setDetailId(result.taskId)
						refreshFiles(result.taskId)
					} else say((result && result.message) || '启动失败')
				})
			}

			const refreshFiles = (taskId) => api('listFiles', { taskId: taskId }).then((result) => {
				if (result && result.ok) setFiles(result.entries)
				else say((result && result.message) || '读取文件清单失败')
			})

			const preview = (task) => api('previewReturn', {
				taskId: task.id,
				parts: { status: true, conclusion: true, file: retFile ? { relPath: retFile } : null, customText: '' }
			}).then((result) => {
				if (result && result.ok) setRetPreview(result.text)
				else say((result && result.message) || '生成预览失败')
			})

			const returnNow = () => {
				if (!retPreview.trim()) { say('返回内容为空'); return }
				api('returnToMain', { mainSessionId: String(currentSessionId || ''), text: retPreview }).then((result) => {
					say(result && result.ok ? '已返回主会话' : ((result && result.message) || '返回失败'))
				})
			}

			/*
			 * Continuing the conversation: the Host keeps the pod agent alive for the
			 * lifetime of the process, so a follow-up lands in the very same session
			 * with the same sandbox, guard and prompt. After a restart the history is
			 * still readable but canFollowUp is false and the box says so.
			 */
			const sendReply = () => {
				if (!detail) return
				const text = reply.trim()
				if (text === '') { say('请输入内容'); return }
				setSending(true)
				api('followUp', { taskId: detail.task.id, text: text }).then((result) => {
					setSending(false)
					if (result && result.ok) { setReply(''); say('已发送，等待隔离舱回应…') }
					else say((result && result.message) || '发送失败')
				})
			}

			const stopTurn = () => {
				if (!detail) return
				api('cancelTask', { taskId: detail.task.id }).then((result) => say(result && result.ok ? '已请求停止' : '停止失败'))
			}

			/** Older persisted entries predate `kind`, so fall back to the event type. */
			const entryKind = (entry) => {
				if (entry && entry.kind) return entry.kind
				const type = entry ? entry.type : ''
				if (type === 'user/message') return 'user'
				if (type === 'assistant/message') return 'assistant'
				if (type === 'tool/call' || type === 'tool/result') return 'tool'
				return 'turn'
			}

			const renderEntry = (entry, index) => {
				const kind = entryKind(entry)
				if (kind === 'turn') return h('div', { key: index, className: 'ipp-sep' }, entry.text || '')
				if (kind === 'tool') return h('div', { key: index, className: 'ipp-tool' },
					h('span', { className: 'ipp-toolname' }, entry.type === 'tool/call' ? '▶' : '◀'),
					h('span', null, entry.text || ''))
				if (kind === 'user') return h('div', { key: index, className: 'ipp-msg user' },
					h('div', { className: 'ipp-who' }, '我'),
					h('div', { className: 'ipp-bubble' }, entry.text || ''))
				if (kind === 'prompt') return h('details', { key: index, className: 'ipp-brief' },
					h('summary', null, '本轮发给隔离舱的指令（含沙箱规则与只读的主会话上下文）'),
					h('div', { className: 'ipp-briefbody' }, entry.text || ''))
				return h('div', { key: index, className: 'ipp-msg bot' },
					h('div', { className: 'ipp-who' }, '隔离舱'),
					entry.think ? h('details', { className: 'ipp-think' },
						h('summary', null, '思考过程（' + String(entry.think.length) + ' 字）'),
						h('div', { className: 'ipp-thinkbody' }, entry.think)) : null,
					entry.text ? h('div', { className: 'ipp-bubble' }, entry.text) : null)
			}

			const runExport = () => {
				if (!detail) return
				const entries = Object.keys(picked).filter((key) => picked[key])
				if (!entries.length) { say('请至少勾选一个条目'); return }
				if (!exportDir.trim()) { say('请指定导出目标目录'); return }
				setConfirmExport(true)
			}

			const confirmExportNow = () => {
				setConfirmExport(false)
				const entries = Object.keys(picked).filter((key) => picked[key])
				api('exportEntries', {
					taskId: detail.task.id, entries: entries, targetDir: exportDir,
					mode: exportMode, conflict: exportConflict, remember: remember
				}).then((result) => {
					if (result && result.ok) say('导出完成：' + (result.items || []).filter((item) => item.status === 'OK').length + ' 项')
					else say((result && result.message) || '导出失败')
				})
			}

			const pickDirectory = () => {
				const uiWorkspace = ctx.get('uiWorkspace')
				if (!uiWorkspace || !uiWorkspace.pickDirectory) { say('当前环境不支持目录选择，请手动输入路径'); return }
				uiWorkspace.pickDirectory().then((chosen) => { if (chosen) setExportDir(String(chosen)) })
					.catch(() => say('目录选择失败，请手动输入'))
			}

			const saveConfig = () => {
				if (!cfg) return
				api('setConfig', {
					patch: {
						sandboxRoot: cfg.sandboxRoot, allowWrites: cfg.allowWrites, allowedTools: cfg.allowedTools,
						timeoutMs: Number(cfg.timeoutMs), readContext: cfg.readContext,
						maxConcurrent: Number(cfg.maxConcurrent), enableExport: cfg.enableExport,
						allowRememberChoice: cfg.allowRememberChoice, presetId: cfg.presetId
					}
				}).then((result) => {
					say(result && result.ok
						? ('配置已保存' + ((result.messages && result.messages.length) ? '：' + result.messages.join('；') : ''))
						: ((result && result.message) || '保存失败'))
					return api('getState', { mainSessionId: String(currentSessionId || '') })
				}).then((fresh) => {
					if (fresh && fresh.ok) { setState(fresh); setCfg(JSON.parse(JSON.stringify(fresh.config))) }
				})
			}

			const warnings = (state && state.sandbox) ? [
				!state.sandbox.set ? h('div', { key: 'a', className: 'ipp-warn' }, '尚未配置沙箱根目录。隔离舱会拒绝执行任何任务（这是设计行为）。请到「配置」中手动指定。') : null,
				state.sandbox.set && !state.sandbox.exists ? h('div', { key: 'b', className: 'ipp-warn' }, '沙箱根目录当前不存在：' + state.sandbox.root + '（启动任务时会创建）') : null,
				state.sandbox.insideMainCwd ? h('div', { key: 'c', className: 'ipp-warn' }, '注意：沙箱根目录位于当前会话工作区之内，隔离任务生成的文件会出现在你看到的工作区里。') : null,
				state.sandbox.set && !state.sandbox.insideMainCwd ? h('div', { key: 'd', className: 'ipp-mut' }, '沙箱根目录：' + state.sandbox.root) : null
			].filter(Boolean) : []

			const tasksView = h('div', null, warnings,
				(state && state.tasks && state.tasks.length) ? state.tasks.map((task) => h('div', { key: task.id, className: 'ipp-card' },
					h('div', { className: 'ipp-row' },
						h(StatusChip, { status: task.status }),
						h('strong', null, task.label || task.id),
						h('span', { className: 'ipp-mut' }, new Date(task.createdAt).toLocaleString()),
						(task.endedAt && task.startedAt) ? h('span', { className: 'ipp-mut' }, '耗时 ' + Math.round((task.endedAt - task.startedAt) / 1000) + 's') : null,
						h('span', { style: { flex: 1 } }),
						h('button', { className: 'ipp-btn', onClick: () => { logCursor.current = 0; setDetailId(task.id); refreshFiles(task.id) } }, '查看'),
						task.status === 'running' ? h('button', { className: 'ipp-btn', onClick: () => api('cancelTask', { taskId: task.id }).then(() => say('已请求取消')) }, '取消') : null,
						h('button', { className: 'ipp-btn', onClick: () => api('cleanup', { taskId: task.id, scope: 'all' }).then(() => { say('已清理'); setDetailId('') }) }, '清理')),
					task.error ? h('div', { className: 'ipp-chip err' }, task.error.slice(0, 160)) : null,
					task.finalText ? h('div', { className: 'ipp-mut', style: { marginTop: 6 } }, task.finalText.slice(0, 240)) : null))
					: h('div', { className: 'ipp-mut' }, '还没有隔离任务。切到「新建」启动一个。'))

			const newView = h('div', null, warnings,
				h('div', { className: 'ipp-card' },
					h('div', { className: 'ipp-row' }, h('span', { className: 'ipp-lab' }, '任务描述')),
					h('textarea', { className: 'ipp-ta', value: desc, placeholder: '例如：用 Python 生成一个 CSV 文件', onChange: (event) => setDesc(event.target.value) }),
					h('div', { className: 'ipp-row', style: { marginTop: 8 } },
						h('span', { className: 'ipp-lab' }, '沙箱子目录'),
						h('input', { className: 'ipp-in', value: subdir, placeholder: '可选，例如 task-a', onChange: (event) => setSubdir(event.target.value) })),
					h('div', { className: 'ipp-row' },
						h('button', { className: 'ipp-btn pri', disabled: !(state && state.sandbox && state.sandbox.set), onClick: start }, '启动隔离任务'),
						h('span', { className: 'ipp-mut' }, (state && state.sandbox && state.sandbox.set)
							? '任务在主会话之外运行；主会话不会收到任何自动消息。'
							: '需要先配置沙箱根目录。'))))

			const detailView = (detail && detail.task) ? h('div', null,
				h('div', { className: 'ipp-card' },
					h('div', { className: 'ipp-row' },
						h(StatusChip, { status: detail.task.status }),
						h('strong', null, detail.task.label || detail.task.id),
						detail.task.sandboxMode ? h('span', { className: 'ipp-chip' }, 'mode=' + detail.task.sandboxMode) : null,
						detail.task.fsDenied ? h('span', { className: 'ipp-chip ok' }, '越界写已被拒绝') : null,
						h('span', { style: { flex: 1 } }),
						h('button', { className: 'ipp-btn', onClick: () => { setDetailId(''); setDetail(null); setFiles(null); setPicked({}); setRetPreview('') } }, '返回列表')),
					h('div', { className: 'ipp-mut' }, '沙箱：' + detail.task.taskDir),
					detail.task.error ? h('div', { className: 'ipp-chip err' }, detail.task.error) : null,
					detail.task.contextNote ? h('div', { className: 'ipp-mut' }, '主会话上下文：' + detail.task.contextNote) : null,
					h('div', { className: 'ipp-row', style: { marginTop: 8 } },
						h('span', { className: 'ipp-lab' }, '可用工具'),
						h('span', { className: 'ipp-mut' }, (detail.task.allow || []).join(', ')))),
				h('div', { className: 'ipp-card' },
					h('div', { className: 'ipp-row' },
						h('strong', null, '对话'),
						h('span', { className: 'ipp-mut' }, '共 ' + detail.task.logCount + ' 条 · 第 ' + (detail.task.turns || 1) + ' 轮'),
						detail.task.status === 'running' ? h('span', { className: 'ipp-run' }, '运行中…') : null,
						h('span', { style: { flex: 1 } }),
						h('span', { className: 'ipp-mut' }, detail.task.canFollowUp ? '可继续对话' : '进程重启后仅可查看')),
					h('div', { className: 'ipp-chat', ref: chatRef },
						(detail.log || []).length ? (detail.log || []).map(renderEntry)
							: h('div', { className: 'ipp-mut' }, detail.task.status === 'running' ? '等待隔离舱开始…' : '（暂无记录）')),
					h('div', { className: 'ipp-send' },
						h('textarea', {
							className: 'ipp-ta', rows: 2, value: reply,
							disabled: !detail.task.canFollowUp || detail.task.status === 'running',
							placeholder: !detail.task.canFollowUp
								? '该会话已随进程结束，无法继续对话（历史仍可查看）'
								: (detail.task.status === 'running' ? '隔离舱正在运行，等它回应或点「停止」' : '继续对话 —— 回车发送，Shift+回车换行'),
							onChange: (event) => setReply(event.target.value),
							onKeyDown: (event) => {
								if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendReply() }
							}
						}),
						h('div', { className: 'ipp-row' },
							h('button', {
								className: 'ipp-btn pri',
								disabled: !detail.task.canFollowUp || detail.task.status === 'running' || !reply.trim(),
								onClick: sendReply
							}, sending ? '发送中…' : '发送'),
							detail.task.status === 'running' ? h('button', { className: 'ipp-btn', onClick: stopTurn }, '停止') : null,
							h('span', { className: 'ipp-mut' }, '沙箱与工具白名单在整段对话中保持不变；主会话不会自动收到任何内容。')))),
				h('div', { className: 'ipp-card' },
					h('div', { className: 'ipp-row' }, h('strong', null, '生成文件'),
						h('button', { className: 'ipp-btn', onClick: () => refreshFiles(detail.task.id) }, '刷新')),
					(files || []).length ? (files || []).map((file) => h('div', { key: file.relPath, className: 'ipp-row' },
						h('input', {
							type: 'checkbox', checked: !!picked[file.relPath],
							onChange: (event) => { const next = Object.assign({}, picked); next[file.relPath] = event.target.checked; setPicked(next) }
						}),
						h('span', null, file.relPath),
						h('span', { className: 'ipp-mut' }, file.type + (file.size === null ? '' : ' · ' + file.size + 'B'))))
						: h('div', { className: 'ipp-mut' }, '（暂无文件，或尚未刷新）')),
				h('div', { className: 'ipp-card' },
					h('strong', null, '返回主会话'),
					h('div', { className: 'ipp-mut', style: { margin: '4px 0 8px' } }, '默认不返回任何内容。以下内容会以一条消息注入主会话，注入前你可以自由编辑。导出文件与返回消息是两个互不触发的操作。'),
					h('div', { className: 'ipp-row' },
						h('span', { className: 'ipp-lab' }, '附带文件'),
						h('input', { className: 'ipp-in', value: retFile, placeholder: '可选：清单中的相对路径', onChange: (event) => setRetFile(event.target.value) })),
					h('div', { className: 'ipp-row' }, h('button', { className: 'ipp-btn', onClick: () => preview(detail.task) }, '生成预览')),
					h('textarea', { className: 'ipp-ta', value: retPreview, onChange: (event) => setRetPreview(event.target.value) }),
					h('div', { className: 'ipp-row' },
						h('button', { className: 'ipp-btn pri', disabled: !retPreview.trim(), onClick: returnNow }, '确认返回主会话'))),
				detail.task.status !== 'running' ? h('div', { className: 'ipp-card' },
					h('strong', null, '导出到工作区'),
					h('div', { className: 'ipp-mut', style: { margin: '4px 0 8px' } }, '每次导出都需要手动确认，不存在自动延续的授权。'),
					h('div', { className: 'ipp-row' },
						h('span', { className: 'ipp-lab' }, '目标目录'),
						h('input', { className: 'ipp-in', value: exportDir, onChange: (event) => setExportDir(event.target.value), placeholder: '绝对路径' }),
						h('button', { className: 'ipp-btn', onClick: pickDirectory }, '选择')),
					h('div', { className: 'ipp-row' },
						h('span', { className: 'ipp-lab' }, '方式'),
						h('select', { className: 'ipp-in', value: exportMode, onChange: (event) => setExportMode(event.target.value) },
							h('option', { value: 'copy' }, '复制'), h('option', { value: 'move' }, '移动')),
						h('span', { className: 'ipp-lab' }, '冲突'),
						h('select', { className: 'ipp-in', value: exportConflict, onChange: (event) => setExportConflict(event.target.value) },
							h('option', { value: 'overwrite' }, '覆盖'), h('option', { value: 'skip' }, '跳过'), h('option', { value: 'rename' }, '重命名'))),
					(state && state.config && state.config.allowRememberChoice) ? h('div', { className: 'ipp-row' },
						h('input', { type: 'checkbox', checked: remember, onChange: (event) => setRemember(event.target.checked) }),
						h('span', null, '记住本次选择（仅预填路径，仍需每次确认）')) : null,
					h('div', { className: 'ipp-row' }, h('button', { className: 'ipp-btn pri', onClick: runExport }, '导出到工作区')),
					confirmExport ? h('div', { className: 'ipp-card', style: { borderColor: 'var(--dsw-alias-state-warn-primary)' } },
						h('div', null, '确认导出 ' + Object.keys(picked).filter((key) => picked[key]).length + ' 项到：' + exportDir + ' ？'),
						h('div', { className: 'ipp-row', style: { marginTop: 8 } },
							h('button', { className: 'ipp-btn pri', onClick: confirmExportNow }, '确认'),
							h('button', { className: 'ipp-btn', onClick: () => setConfirmExport(false) }, '取消'))) : null) : null,
				h('div', { className: 'ipp-row' },
					h('button', { className: 'ipp-btn', onClick: () => api('cleanup', { taskId: detail.task.id, scope: 'files' }).then(() => { say('已删除该任务的沙箱文件'); refreshFiles(detail.task.id) }) }, '删除任务文件'),
					h('button', { className: 'ipp-btn', onClick: () => api('cleanup', { taskId: detail.task.id, scope: 'all' }).then(() => { say('已清理任务'); setDetailId(''); setDetail(null) }) }, '清理任务记录与文件')))
				: h('div', { className: 'ipp-mut' }, '未选择任务')

			const configView = (state && cfg) ? h('div', null,
				h('div', { className: 'ipp-card' },
					h('div', { className: 'ipp-row' },
						h('span', { className: 'ipp-lab' }, '沙箱根目录'),
						h('input', { className: 'ipp-in', value: cfg.sandboxRoot, placeholder: '必须手动指定绝对路径，例如 E:\\pod-work', onChange: (event) => setCfg(Object.assign({}, cfg, { sandboxRoot: event.target.value })) })),
					h('div', { className: 'ipp-mut' }, '未指定时隔离舱拒绝执行任务，且不会自动使用工作区。'),
					h('div', { className: 'ipp-row', style: { marginTop: 8 } },
						h('input', { type: 'checkbox', checked: !!cfg.allowWrites, onChange: (event) => setCfg(Object.assign({}, cfg, { allowWrites: event.target.checked })) }),
						h('span', null, '允许文件写入（始终限制在沙箱内）')),
					h('div', { className: 'ipp-row' },
						h('input', { type: 'checkbox', checked: !!cfg.readContext, onChange: (event) => setCfg(Object.assign({}, cfg, { readContext: event.target.checked })) }),
						h('span', null, '读取主会话上下文（只读，默认开启）')),
					h('div', { className: 'ipp-row' },
						h('span', { className: 'ipp-lab' }, '超时（秒）'),
						h('input', { className: 'ipp-in', type: 'number', value: Math.round((cfg.timeoutMs || 600000) / 1000), onChange: (event) => setCfg(Object.assign({}, cfg, { timeoutMs: Number(event.target.value) * 1000 })) }),
						h('span', { className: 'ipp-lab' }, '并发上限'),
						h('input', { className: 'ipp-in', type: 'number', value: cfg.maxConcurrent, onChange: (event) => setCfg(Object.assign({}, cfg, { maxConcurrent: Number(event.target.value) })) })),
					h('div', { className: 'ipp-row' },
						h('input', { type: 'checkbox', checked: !!cfg.enableExport, onChange: (event) => setCfg(Object.assign({}, cfg, { enableExport: event.target.checked })) }),
						h('span', null, '启用「导出到工作区」'),
						h('input', { type: 'checkbox', checked: !!cfg.allowRememberChoice, onChange: (event) => setCfg(Object.assign({}, cfg, { allowRememberChoice: event.target.checked })) }),
						h('span', null, '允许「记住本次选择」')),
					h('div', { className: 'ipp-row' },
						h('span', { className: 'ipp-lab' }, 'Agent preset'),
						h('input', { className: 'ipp-in', value: cfg.presetId || '', placeholder: 'standard', onChange: (event) => setCfg(Object.assign({}, cfg, { presetId: event.target.value })) }),
						h('span', { className: 'ipp-mut' }, '隔离 Agent 的工具来自 preset；留空则没有任何工具。')),
					h('div', { className: 'ipp-row' }, h('button', { className: 'ipp-btn pri', onClick: saveConfig }, '保存配置'))),
				h('div', { className: 'ipp-card' },
					h('strong', null, '允许隔离环境使用的工具'),
					h('div', { className: 'ipp-mut', style: { margin: '4px 0 8px' } }, '未勾选的工具会被硬性拒绝（隔离环境调用时直接报错）。'),
					h('div', { className: 'ipp-tools' }, (state.toolChoices || []).map((tool) => h('label', { key: tool, className: 'ipp-row', style: { margin: 0, minWidth: 200 } },
						h('input', {
							type: 'checkbox', checked: (cfg.allowedTools || []).indexOf(tool) >= 0,
							onChange: (event) => {
								const next = (cfg.allowedTools || []).slice()
								const at = next.indexOf(tool)
								if (event.target.checked && at < 0) next.push(tool)
								if (!event.target.checked && at >= 0) next.splice(at, 1)
								setCfg(Object.assign({}, cfg, { allowedTools: next }))
							}
						}),
						h('span', null, tool))))))
				: h('div', { className: 'ipp-mut' }, error ? ('配置未能加载：' + error) : '配置加载中…')

			const exportsView = h('div', null,
				(state && state.exports && state.exports.length) ? state.exports.map((record) => h('div', { key: record.id, className: 'ipp-card' },
					h('div', { className: 'ipp-row' },
						h('strong', null, record.label || record.taskId),
						h('span', { className: 'ipp-mut' }, new Date(record.at).toLocaleString()),
						h('span', { className: 'ipp-chip' }, record.mode === 'move' ? '移动' : '复制'),
						h('span', { className: 'ipp-mut' }, record.targetDir)),
					(record.items || []).map((item, index) => h('div', { key: index, className: 'ipp-line' },
						h('span', { className: 'ipp-t' }, item.status), item.src + ' → ' + item.dst + (item.message ? ' · ' + item.message : ''))),
					record.undoneAt ? h('div', { className: 'ipp-chip warn' }, '已撤销')
						: (record.mode === 'copy' ? h('div', { className: 'ipp-row', style: { marginTop: 8 } },
							h('button', { className: 'ipp-btn', onClick: () => api('undoExport', { exportId: record.id }).then((result) => say(result && result.ok ? '已撤销' : ((result && result.message) || '撤销失败'))) }, '撤销此次导出'))
							: h('div', { className: 'ipp-mut' }, '移动模式不支持撤销'))))
					: h('div', { className: 'ipp-mut' }, '还没有导出记录。'))

			const body = tab === 'tasks' ? (detailId ? detailView : tasksView)
				: (tab === 'new' ? newView : (tab === 'config' ? configView : exportsView))

			return h('div', { className: 'ipp-root' },
				h('div', { className: 'ipp-bar' },
					h('strong', null, '隔离舱'),
					TABS.map((entry) => h('button', {
						key: entry[0], className: 'ipp-tab' + (tab === entry[0] ? ' on' : ''),
						onClick: () => setTab(entry[0])
					}, entry[1])),
					h('span', { style: { flex: 1 } }),
					toast ? h('span', { className: 'ipp-mut' }, toast) : null,
					currentSessionId
						? h('span', { className: 'ipp-mut' }, '主会话 ' + String(currentSessionId).slice(0, 16) + '…')
						: h('span', { className: 'ipp-chip warn' }, '未定位主会话')),
				h('div', { className: 'ipp-body' },
					error ? h('div', { className: 'ipp-warn' }, '隔离舱接口暂时不可用：' + error) : null,
					body))
		}

		function apply(ctx) {
			const style = document.createElement('style')
			style.dataset.plugin = 'dsh-isolation-pod'
			style.textContent = CSS
			document.head.appendChild(style)
			ctx.effect(() => () => style.remove())

			const BoundPanelIcon = (props) => PanelIcon(props)
			const BoundPanel = (props) => Panel(props, ctx)

			ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
				{ name: 'sidebar.panellist', id: 'isolation-pod', order: 60, label: '隔离舱' }, BoundPanelIcon))
			ctx.slots.inject('main', () => ctx.slots.register(
				{ name: 'main', key: 'isolation-pod' }, BoundPanel))
		}

		exports.apply = apply
		exports.inject = ['slots']
		return module.exports
	}
})
