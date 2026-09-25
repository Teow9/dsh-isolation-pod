# Isolation Pod

> Runs isolated tasks under sandbox constraints outside the DSH main session. The main session stays
> **completely unaware** by default: no messages written, nothing added to the model context, no traces in the
> UI message stream. Returning a result and exporting files are both **manual, singly-authorized** actions.

**English** | [简体中文](README.md)

| Item | Content |
|---|---|
| Current version | **v0.1.3** (adapted to DSH **0.1.7**) |
| Form | A local package plus one profile patch row; **not** a dynamic Cordis plugin — resident with the host, no approval cards |
| Dependencies | Zero npm dependencies; the Host half uses `node:*` built-ins only; no build step |
| Platform | Windows (task-directory creation/removal and export shell out to PowerShell); both the Desktop `desktop` profile and `dsh web` are adapted |
| License | MIT, see [`LICENSE`](LICENSE) |

### Documentation index

| Document | Reader | Content |
|---|---|---|
| `README.md` (this file) | Users, second-party developers | Features, how it works, installation, usage, interfaces, model, limitations |
| [`README.en.md`](README.en.md) | English readers | The English version of this file, section for section |
| [`使用教程.md`](使用教程.md) | First-time users | A step-by-step walkthrough in operating order, troubleshooting, item-by-item acceptance |
| [`需求说明.md`](需求说明.md) | Requirements and acceptance | The functional-specification **baseline** (no implementation, not revised with releases) |
| [`CHANGELOG.md`](CHANGELOG.md) | Everyone | Version history (Keep a Changelog format) |

> **Conventions used in this document**: code, identifiers and paths are written in `backticks`; on-screen
> wording is quoted in 「corner brackets」; versions are written `v0.1.3`, DSH versions `0.1.7`, dates
> `YYYY-MM-DD`. Every "verified" conclusion states the **plugin version + platform** it was measured on.

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [HTTP interface](#http-interface)
- [Data and file layout](#data-and-file-layout)
- [Isolation and permission model](#isolation-and-permission-model)
- [Desktop differences](#desktop-differences)
- [Glossary](#glossary)
- [Verified behaviour](#verified-behaviour)
- [Deltas from the specification](#deltas-from-the-specification)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Related documents](#related-documents)

## Features

- **Zero traces in the main session**: an isolated task runs in its own child session and writes nothing to the
  main session at all; only pressing *Return to main session*（返回主会话）injects **one** editable, condensed
  result.
- **The sandbox is enforced by the system**: read/write inside the sandbox root, **read-only** outside it.
  Out-of-bounds writes are hard-denied by the DSH file sandbox (`FS_SANDBOX_DENIED`), not left to the prompt's
  good behaviour. A pre-flight out-of-bounds write probe runs before every task and aborts it if the write was
  not denied.
- **The tool allowlist is enforced by the guard**: the allowlist is an **upper bound** only; calls outside it
  are rejected outright with `未被授权` ("not authorised").
- **Return and export never trigger each other**: both are singly authorized, and every export must be
  confirmed again.
- **Resident and approval-free**: loaded as a patch row with the host; configuration, tasks and export records
  survive restarts; no approval prompt ever appears inside the isolated environment.
- **Multi-turn conversation**: the task detail view *is* the conversation, and follow-ups continue in the same
  child session.
- **Inspectable and cleanable**: transcript, tool calls, reasoning and the generated-file list all live in the
  panel, and file contents can be previewed in place; cleanup touches neither the main session nor any file
  outside the sandbox.

## How it works

### Form: a local package plus a profile patch row

```
<repo root>\                                        ← the repo root IS the package
  package.json                                        name = dsh-isolation-pod (also the browser module id)
  lib\index.js                                        Host half: execution engine + HTTP API + persistence
  lib\client.js                                       Client half: hand-written __ModuleLoader__ bundle (panel)
  README.md / README.en.md / 使用教程.md / 需求说明.md / CHANGELOG.md

<DSH_HOME>\profiles\<profile>\cordis.patch.yml       ← the only external change (one appended insert item)
                                                      the Desktop app uses profiles\desktop\
<DSH_HOME>\isolation-pod.json                        ← config, tasks and export records (created at runtime)
<DSH_HOME>\sessions\...                              ← the child session's own log (written by DSH)
```

The host rewrites the **absolute path** in the patch row into a `file://` URL and mounts the Host half;
`dsh-client-modules` then walks up from that same file to the nearest `package.json`, reads its `dsh.client`,
and resolves the Client half through `exports["./client"]`.
**The whole chain needs neither a bundler nor an npm publish.**

### Life of one isolation task

1. the panel hands the task description to the Host half through `POST /isolation-pod/api`;
2. the Host half creates the task directory and a **standalone child session**
   (`origin: 'subagent'`, cwd = the sandbox root);
3. inside that child's setup window it writes `sandbox/mode` and `approval/policy`, mounts the Agent preset,
   probes the pod's real tool surface, and then installs the tool guard and the system prompt section;
4. it runs an **out-of-bounds write probe** first, confirming that a write outside the sandbox really is denied
   — otherwise the task is aborted;
5. it delivers the task prompt (sandbox rules, allowlist, a read-only slice of the main-session context) into
   the child session as one user message;
6. every child-session event is folded into a transcript entry (user / assistant / tool / turn / reasoning)
   that the panel pulls incrementally;
7. the task settles at *completed* and waits for the user's decision: keep talking, return to the main session,
   export files, or clean up.

### Host interface contract (DSH 0.1.7)

The Host half depends only on DSH's public services and imports no `@deepseek-ai/*` package — the plugin lives
outside the dsh install, so bare specifiers would not resolve. These interfaces are **load-bearing**:

| Interface | The real shape in 0.1.7 | How this plugin handles it |
|---|---|---|
| Child session | `ctx.agents.create({ sessionId, meta, agentOptions, setup })` | Used as-is; `meta = { cwd: sandbox root, origin: 'subagent' }` |
| In-session policy | `session.append('sandbox/mode' \| 'approval/policy', …)` | Used as-is (the `sandbox/mode` fold reads only `data.mode`) |
| Tool surface | the host plane is layered per preset; on Windows only `pwsh`, there is no `bash` | asks for **that pod's agent as the scope** — `agentCtx.tools.schemas(agent)`; **omitting the scope answers for the global plane** (disjoint from the allowlist, which in v0.1.2 left a pod unable to call a single tool). The real surface is taken from the pod's own `request/header` as authoritative, superseding the probe |
| Tool interception | `tools.guard(fn)` is authoritative; `tools.restrict({ allow })` throws on an unknown name | the guard decides; `restrict` is given only names this pod actually has, and the whole call is try/catch |
| Sandbox verdict | `ctx.sandboxPolicy.resolve({ session })` → `{ mode, workspaceRoot }` | the probe confirms the mode and the writable root from it |
| In-process command | `ctx.shell.resolve(req)` + `execute(spec)` → handle `.result()` | probes for `execute` and falls back to `shell.run`; `/status.compat.shellApi` reports the verdict |
| Page injection | structured `webserver/index-inject` rows (the Desktop delivers them over IPC) | delivers the token as a `{ kind: 'global' }` row and does **not** use `tapIndex` (the Desktop never runs taps) |
| Session-list snapshot | no `current` field; `retainedBy.mainView` marks the session the main view is showing | the panel resolves the main session from that field, keeping the old field as a fallback |
| Message source | the closed union `user \| model \| tool \| system-prompt` | `followup` always uses `{ kind: 'user' }` |
| Startup audit | startup is refused only when the fixed required set (`agent-loop`, `webserver`, `modules`, `connection`, `headless-runner`, `acp`, `sdk-jsonrpc-server`) is inactive | does not rely on that protection; every registration is wrapped in try/catch and recorded in `diagnostics` |
| Compatibility gate | evaluated only when a plugin declares `peerDependencies` | declares **no** DSH peer, so a version gate cannot block it |

## Requirements

- **DSH 0.1.7** (including the Desktop app, 0.1.7-rc.2). The Desktop `desktop` profile is
  `dsh-base` + `dsh-web-app`, the same composition as `dsh web`, so the two share one profile patch and one set
  of services.
- **OS**: Windows. Task-directory creation/removal and export run through PowerShell commands (`ctx.shell`) and
  have not been verified on macOS / Linux.
- **Node**: whatever DSH ships. The plugin has zero dependencies — no `npm install` and no build step.

## Installation

### 1. Get the package

```powershell
git clone https://github.com/Teow9/dsh-isolation-pod
```

### 2. Mount the patch row

Edit `<DSH_HOME>\profiles\<profile>\cordis.patch.yml` (`<DSH_HOME>` defaults to `%USERPROFILE%\.dsh`;
the **Desktop app** uses `profiles\desktop\cordis.patch.yml`). The file usually holds comments and a few
id-targeted entries — **append** one item to the end of the array:

```yaml
- insert:
    - id: dsh-isolation-pod
      name: '<absolute path to this repo>\lib\index.js'
```

Saving applies it at once:

- **the Host half activates on the spot** — `dsh-hmr` watches the profile patch;
- **the Client half mounts by itself** — the module graph is recomposed and pushed to the page over
  `/plugins/events`, so the sidebar gains *Isolation Pod*（隔离舱）with **no page refresh and no app restart**.

> ⚠️ `name` must be an **absolute path** pointing at `lib\index.js` (the Host half). Do not append a query
> string such as `?v=2`: `fileURLToPath` rejects URLs with a search component. Do not put another
> `package.json` under `lib\` either: the Client half is resolved by walking up to the nearest one.

> ℹ️ Put it in a **specific profile**, not in `<DSH_HOME>\cordis.patch.yml`. The latter applies to every
> profile, and a CLI/TUI profile has no `webServer`, so that row would sit permanently in the "waiting for
> services" inactive state. DSH 0.1.7 only prints a warning about it (startup is refused only for the built-in
> required plugins), but that warning means nothing.

### 3. Verify

```powershell
# Desktop app: dsh-desktop-host always binds 19387
curl.exe -s http://127.0.0.1:19387/isolation-pod/status
# dsh web: 3080 by default; use the URL it printed at startup
curl.exe -s http://127.0.0.1:3080/isolation-pod/status
```

```json
{
  "ok": true,
  "build": 8,
  "pluginVersion": "0.1.3",
  "tokenPrefix": "b0ef7657",
  "taskCount": 0,
  "storePath": "C:\\Users\\<you>\\.dsh\\isolation-pod.json",
  "sandbox": {
    "root": "E:\\pod-work",
    "liveSessions": [ { "id": "session-…", "origin": "", "cwd": "…", "insideSandbox": false } ]
  },
  "compat": { "shellApi": "execute", "indexInject": true, "bootstrap": true },
  "diagnostics": [ { "at": 1790316223866, "message": "shell API: execute" } ]
}
```

| `compat` field | Expected | Meaning |
|---|---|---|
| `shellApi` | `execute` | Uses 0.1.7's `ctx.shell.execute()`; `run` means it fell back to the old interface, `missing` means that service is unreadable |
| `indexInject` | `true` | The structured index-injection row for the token is registered |
| `bootstrap` | `true` | The `/isolation-pod/bootstrap` token channel is available (it needs the `connection` service) |

An *Isolation Pod* entry appearing in the sidebar means the install worked. If the panel reports the token as
unavailable, that page predates the plugin: the panel fetches `/isolation-pod/bootstrap` first and then reloads
itself once; if that still fails, quit and reopen the app.

### 4. Upgrade

```powershell
git pull
```

- **a Host-half change requires an app restart**: `lib\index.js` is cached by Node per URL, so a hot reload does
  not re-read it from disk;
- Client-half and patch-row changes are hot;
- no manual config migration: `sandboxRoot` is normalized when read back (a trailing backslash is dropped).

### 5. Uninstall / rollback

Delete that `- insert:` item from the patch file and save — it hot-unloads (the HTTP route disappears, the
resident agents are released, state is persisted). To remove it completely, delete the file or restore its
original content (a missing file means "no layer").

> Copy `cordis.patch.yml.bak` before installing. Under 0.1.7 an inactive plugin row only warns and never wedges
> startup, but a backup means the rollback is one step.

## Usage

### Entry point

One row in the sidebar, directly under *New session*: a shield icon plus *Isolation Pod*（隔离舱）. When the
sidebar is collapsed to a narrow strip only the icon shows. Clicking it switches the centre column to the
full-width pod panel, whose tabs are **Tasks / New / Config / Export history**（任务 / 新建 / 配置 / 导出记录）.

> There is deliberately **no** entry at the sidebar foot (next to Settings): that row is shared with the
> built-in Cordis Plugin button, where a labelled or fixed-width button gets squeezed away.

### First run: set the sandbox root

Open *Config* and enter an **absolute path** (for example `E:\pod-work`). Until it is set the pod refuses to run
any task, and it will **not** silently fall back to your workspace or project directory.

The **Agent preset** on the same page (a dropdown when available) decides which tools the isolated Agent can
see: **the allowlist is only an upper bound and is never emptied by intersecting it with the preset**; a tool
the preset does not provide is rejected by the guard at call time with `未被授权` ("not authorised"). The task
detail view therefore lists `可用工具` ("available tools", the allowlist upper bound) beside `隔离环境实有`
("actually available in the isolated environment", the surface this pod can really see) so the two can be
reconciled.

### Task

New task (description, optional sandbox subdirectory) → start → watch the **conversation** and **generated
files** in the detail view → keep talking / return to the main session / export to the workspace → clean up.
The main session receives no automatic message while this happens.

The task detail view runs top to bottom: status and sandbox-probe information, conversation, generated files,
return to main session, export to workspace, cleanup. (While the task is `running`, the
*Export to workspace* card is not shown — wait for it to finish or press *Stop*.)

### Multi-turn conversation

The bottom of the detail view is an input box: **Enter sends, Shift+Enter inserts a newline**, and *Stop*
cancels the running turn.

- Follow-ups go through `followUp`, posting one more user message into the **same child session**; sandbox
  mode, approval policy, tool guard and system prompt section all hang off the resident child agent and are
  reused as-is. **There is no path where the isolation weakens on a follow-up.**
- The transcript renders by role: `我` ("me") / `隔离舱` ("Isolation Pod") bubbles, `▶ ◀` tool rows, turn
  separators; assistant entries expand into a **reasoning** block, and the first turn's machine prompt is
  collapsed as `本轮发给隔离舱的指令` ("the instruction sent to the pod this turn").
- **Continuity lasts for the process lifetime only**: after a host restart `canFollowUp` becomes false and the
  input box notes `该会话已随进程结束` ("this session ended with the process"), while history stays readable and
  exportable. (Re-attaching after a restart is explicitly out of scope.)

### Return to the main session

In the *Return to main session* block you may attach one file path, press *Generate preview* to get a text
block, **edit that text freely**, and only then press *Confirm return to main session*（确认返回主会话）— which
delivers it into the main session as **one user message**. By default nothing is returned.

### Export to the workspace

Select generated files → enter an **absolute target directory outside the sandbox** → choose the mode
(copy / move) and the conflict policy (overwrite / skip / rename) → press *Export to workspace* → confirm again
in the confirmation card. Every export is confirmed on its own; there is no standing authorization. Enabling
`allowRememberChoice` merely pre-fills the path. Copy-mode exports can be undone with *Undo this export*.

### Cleanup

- **Delete task files**: removes that task's task directory (deleting the sandbox root itself is refused).
- **Clean up record and files**: also drops the record and releases that child session's resident agent.
- Neither **touches** the main session or anything outside the sandbox; the child session's own history log is
  managed by DSH and is out of scope for cleanup.

## Configuration

Edited on the *Config* page and persisted to `<DSH_HOME>\isolation-pod.json`.

| Key | Default | Meaning |
|---|---|---|
| `sandboxRoot` | `''` | Sandbox root (absolute path). Empty means tasks are refused; normalized when read back (trailing backslash dropped) |
| `allowWrites` | `true` | When off, the child session runs in `read-only` mode |
| `allowedTools` | `pwsh, read, write, edit, glob, grep` | Tool allowlist, enforced by the guard as an **upper bound** |
| `timeoutMs` | `600000` | Timeout **per turn** (ms), clamped to 30 000–7 200 000; a timeout cancels that turn and marks it `timeout` |
| `readContext` | `true` | Whether the last few main-session messages are injected into the task prompt as **read-only** background |
| `maxConcurrent` | `3` | Maximum number of concurrently running tasks (1–8) |
| `enableExport` | `true` | When off, `exportEntries` refuses outright |
| `allowRememberChoice` | `false` | Whether the export dialog may offer "remember this choice" (it only pre-fills the path) |
| `presetId` | `'standard'` | The Agent preset mounted into the child session; an empty string mounts none |

## HTTP interface

The Host half registers the prefix route `/isolation-pod` on the Web server.

| Route | Auth | Purpose |
|---|---|---|
| `GET /isolation-pod/status` | none | Local diagnostics: `build`, `pluginVersion`, `tokenPrefix`, `taskCount`, `storePath`, `sandbox.liveSessions`, `compat`, `diagnostics` |
| `GET /isolation-pod/bootstrap` | harness browser auth | Returns `{ token }` only to a caller **the harness has authenticated**; this is how a panel mounted after page load fetches its token, otherwise `401` |
| `POST /isolation-pod/api` | `x-ipp-token` header | Single JSON entry point: `{ "method": "...", "args": { ... } }` |

The token is a UUID generated **once per activation**, delivered as a structured index-injection row
(`webserver/index-inject` → `{ kind: 'global', name: '__DSH_IPP__' }`): the Web form renders it into the HTML,
the Desktop shell hands it to the renderer over IPC. The token is never written to disk; a failed check returns
`403`.

`bootstrap` admits a caller when `ctx.connection.requestRejection(req) === undefined`, i.e. the Host/Origin fence
passed **and** the request carries a browser cookie matching this launch. The Desktop attaches that cookie when
forwarding page requests and strips `Origin`, so the panel can fetch its own token; a deployment without the
`connection` service answers `401` and the panel falls back to the other token paths.

The `method` list (14 in total):

| Method | Purpose |
|---|---|
| `getState` / `setConfig` | Read panel state (includes `presetChoices`; pass `{ mainSessionId }` so the sandbox-in-workspace verdict can be answered for the **current** session) / write configuration |
| `startTask` / `getTask` / `cancelTask` / `followUp` | Create a task (returns `taskId`) / incrementally pull task + transcript (`fromLogIndex`) / cancel the current turn / continue the conversation |
| `listFiles` / `readSandboxFile` | Task-directory listing (depth ≤6, at most 1500 entries) / read text (one file ≤300 KB, `maxChars` clamped to 200–20000, default 4000) |
| `previewReturn` / `returnToMain` | Build the return preview text (≤4000 chars, truncated beyond) / inject into the main session (≤8000 chars) |
| `exportEntries` / `listExports` / `undoExport` | Export to the workspace / export history / undo a copy-mode export |
| `cleanup` | `scope`: `record` \| `files` \| `all` |

## Data and file layout

- **State file**: `<DSH_HOME>\isolation-pod.json` (`~/.dsh` when `DSH_HOME` is unset).
  `version: 1`, written with a temp-file + rename atomic swap, debounced 800 ms.
- **Task directory**: `<sandboxRoot>\<taskId>\`; when a subdirectory was given at creation,
  `<sandboxRoot>\<subdir>\`.
- **Caps**: 200 task records, 200 export records, 500 in-memory transcript entries per task; the on-disk mirror
  keeps the last 80 (each text truncated at 400 chars); a task records at most 80 available tools.
- **Per-entry transcript caps**: user / assistant entries are each truncated to 4000 chars, tool calls to
  500 chars and tool results to 800 chars.
- **Read-only context**: with `readContext` on, the last 12 main-session messages (user 700 chars /
  assistant 900 chars, ≤12000 chars in total) are folded into the task prompt.
- **On restart**: tasks still `running` / `queued` are marked `interrupted` (their agent died with the process).
- **Transcript backfill**: when a task's local log copy is missing, `getTask` re-reads the child session's own
  persisted log through `sessionQuery.readSession(childSessionId)` and re-summarizes it.

## Isolation and permission model

| Layer | Mechanism | Effect |
|---|---|---|
| Filesystem | child session `sandbox/mode = workspace-write`, cwd = sandbox root | writable inside the root, **hard-denied outside it** (`FS_SANDBOX_DENIED`) |
| Approval | child session `approval/policy = never` | operations inside the isolated environment never raise an approval prompt |
| Tools | `tools.guard()` (authoritative) + `tools.restrict()` (best effort) | calls outside the allowlist are rejected; `write` / `edit` get an extra path-ownership check |
| Pre-flight | out-of-bounds write probe before every task | if the write was **not** denied the task is aborted — it never runs with a dead sandbox |
| Prompt | injected `isolation-pod/rules` system section | tells the model where it may write, which tools it has, and where outputs go |
| Main-session boundary | standalone child session (no parent agent) | writes no events to the main session; the only entry is a manual `returnToMain` |

The writable roots come from `writableRoots(policy)`: the sandbox root, `/tmp` and the platform temp directory.
The platform temp directory stays writable under `workspace-write`, contained by the system prompt section.

The probe targets the **parent directory of the sandbox root** (for example `E:\pod-work` probes
`E:\__ipp_probe_*.txt`), so the configured value is normalized first. If the root *is* a drive root (such as
`E:\`) there is no parent outside it to probe, so the probe is flagged `skipped-no-parent` and the panel shows
`未做越界写自检（沙箱根是盘符根）` ("no out-of-bounds probe was run — the sandbox root is a drive root") —
actual writes are still hard-denied by the file sandbox on every call.

## Desktop differences

The Desktop app is not a second plugin API: `dsh-desktop-host` launches the **same** Web host on this machine
(`dsh-base` + `dsh-web-app`, bound to `127.0.0.1:19387`), so the profile patch, service names, HTTP routes,
sandbox and approval semantics all match `dsh web`. The differences are in **how the page is produced**:

| | `dsh web` | Desktop |
|---|---|---|
| Page source | the `webServer` SPA fallback (`renderIndex`: structured injection rows first, then `tapIndex`) | Electron's `dsh-app://app/`, with the index read straight from disk by `serveWebDocument` |
| How injections reach the page | written into the HTML as the host renders it | the host hands the **structured rows** to the renderer over IPC, applied during page boot |
| Consequence | — | `tapIndex` **never runs** on Desktop, so the token travels as a `webserver/index-inject` `{ kind: 'global' }` row instead |

Three more things:

1. **Relative paths work**: a page request to `/isolation-pod/api` resolves to `dsh-app://app/…` and Electron
   forwards it to the host with the host cookie, so the panel needs neither the port nor CORS.
2. **Release builds have no *Reload Page* entry**: the reload menu item is registered only in development
   builds, and there is no shortcut. Token (re)acquisition therefore does not depend on the user refreshing by
   hand: the panel tries `window.__DSH_IPP__` → `GET /isolation-pod/bootstrap` → scraping the same-origin `/`
   HTML (the Web path) → a single automatic reload.
3. **Changing the Host half needs an app restart**: Node caches ES modules per URL.

## Glossary

| Term | Meaning |
|---|---|
| **Isolation Pod**（隔离舱） | The plugin as a whole (panel + Host half + Client half) |
| **isolated task / pod**（隔离任务 / pod） | One execution created by the plugin and run outside the main session; also the child session that carries it |
| **main session**（主会话） | The session the user is currently working in; the plugin writes nothing to it by default |
| **child session**（子会话） | The execution session of an isolated task: `origin: 'subagent'`, cwd = the sandbox root, and it cannot be opened as an ordinary session |
| **sandbox root**（沙箱根目录） | The single writable location the user specifies by hand (`sandboxRoot`) |
| **task directory**（任务目录） | One task's output directory: `<sandboxRoot>\<taskId>\`, or the subdirectory that was given |
| **tool allowlist**（工具白名单） | The upper bound of tools the isolated environment may call (`allowedTools`), enforced by the guard |
| **Agent preset**（Agent preset） | The host-side configuration that decides which tools the isolated Agent actually has (`presetId`) |
| **token**（令牌） | The credential generated at random on every activation for `POST /isolation-pod/api`; never written to disk |
| **Host half / Client half**（Host 半 / Client 半） | The plugin's two halves: `lib\index.js` (inside the host process) and `lib\client.js` (inside the page) |
| **host**（宿主） | The DSH process running the plugin: the Desktop app launches it through `dsh-desktop-host`, or the command line runs `dsh web` |

## Verified behaviour

Two groups: **(A)** measured on the Desktop app with DSH 0.1.7 (the changes landed in v0.1.2 / v0.1.3);
**(B)** the historical measurement of v0.1.1 on the Web surface, not yet re-measured on 0.1.7.

**(A) measured on Desktop DSH 0.1.7**

- **Hot install (v0.1.2)**: after appending the patch row to `profiles\desktop\cordis.patch.yml` the Host half
  activates on the spot — **no app restart needed**.
- **Client half hot-mounts (v0.1.2)**: after the module graph is pushed over `/plugins/events`, the page
  registers `sidebar.panellist` (`isolation-pod`, order 60) and `main` (`isolation-pod`) by itself —
  **no page refresh needed** (slot occupants checked against the live runtime, and a `rebuilt` frame was
  observed moving the graph rev from `4b496526c519` to `38808638bf84`).
- **Hot unload (v0.1.2)**: setting that row to `disabled: true` makes the HTTP route disappear immediately
  (`/status` → 404), releases the resident agents and persists state; flipping it back reactivates everything.
- **Token chain and self-healing (v0.1.2)**: when the Client half is hot-mounted the page has no `__DSH_IPP__`,
  so it fetches the token through `/isolation-pod/bootstrap` and the panel renders normally (no error banner,
  `getState` data visible).
- **Token channels closed by default (v0.1.2)**: `/isolation-pod/bootstrap` without a cookie → `401`;
  `/isolation-pod/api` without `x-ipp-token` → `403`.
- **Main-session resolution (v0.1.2)**: the panel resolves the main session through `retainedBy.mainView` and
  no longer shows `未定位到主会话` ("main session not located").
- **A real task did run (v0.1.2, evidenced by the child-session log)**: a real task created the child session
  `pod-session-pod-mugl59wt1` (cwd = the sandbox root, `origin: subagent`). Its log shows
  `sandbox/mode = workspace-write` and `approval/policy = never` (both `source: delegation`), the
  out-of-bounds probe passing, the task prompt carrying the main session's **read-only context** (so the panel's
  identified main session was indeed the current one), two unauthorised calls rejected once each by the guard,
  and finally `turn/end: completed`.
  **That same run exposed the tool-surface defect: the allowlist was emptied and the pod could not call a single
  tool** — fixed in v0.1.3.
- **Tool-surface fix (v0.1.3, offline harness)**: driving the real HTTP routes with a stub context asserts three
  things, all passing — `schemas` is only ever called with the agent as its scope, the allowlist is no longer
  emptied, and `request/header` supersedes the setup-time probe.
- **The warning is answered for the current session only (v0.1.2)**: the panel warns
  `注意：沙箱根目录位于当前会话工作区之内，隔离任务生成的文件会出现在你看到的工作区里。` *only* when the
  sandbox root sits inside the workspace of **the session you are looking at**; `/status` exposes
  `sandbox.liveSessions` so that verdict can be checked from outside.

**(B) v0.1.1 · measured on the Web surface (not re-measured on 0.1.7)**

- Out-of-bounds writes are **hard-denied by the system**: tasks only start after the runtime probe records
  `fsDenied: true`.
- The tool allowlist is enforced by the **guard** (`restrict` cannot remove scoped registrations, so it is only
  a supplement).
- **Zero traces in the main session**: across CSV generation and a 3-turn conversation, the main workspace
  gained no new files and the main session received no automatic messages.
- **Configuration, tasks and export records survive restarts**; still-running tasks are correctly marked
  `interrupted`.
- **Transcripts do not vanish across a restart**: the log is persisted with the state and, when needed,
  backfilled from the child session log (measured: 31 child-session records → 14 transcript entries, matching
  an independent decompression).
- **Multi-turn conversation within one process**: `followUp` reuses the same resident child agent and `turns`
  increments (measured: 3 turns, 25 transcript entries).

> **Not yet re-measured**: the artefact path (generating files → export / undo) has not been walked through on
> 0.1.7 — the run above never reached an artefact because of the tool-surface defect, and the full validation
> after the fix is still to be done. That is also why `E:\pod-work` is currently empty.

## Deltas from the specification

[`需求说明.md`](需求说明.md) is the functional-specification baseline. The deltas below are **deliberate** or
platform-imposed, listed one by one so they can be reconciled:

| Specification | Implementation | Note |
|---|---|---|
| Multi-turn conversation is not described | supported (`followUp`) | An addition of this implementation over the spec; the spec only describes one-shot tasks |
| §4.11.3 "clean up a task **or the whole sandbox**" | cleanup by task only | The sandbox root itself is protected (deletion refused), so one mistaken action cannot wipe the whole tree |
| §4.7.16 "an export should be cancellable or undoable" | only **copy**-mode exports can be undone | A *move* has already moved the source files away, so undo could not restore them and no button is offered |
| §4.8 does not list concurrency or preset | adds `maxConcurrent`, `presetId` | The preset is the only route by which 0.1.7 supplies a tool surface; it is host structure |
| §4.3.5 tool allowlist | the allowlist is an **upper bound**, enforced by the guard | Same purpose (an unauthorized tool must not be callable); tools the preset does not provide are rejected too, but the allowlist is never emptied |
| No platform restriction | Windows only | Task-directory creation/removal and export run through PowerShell; macOS / Linux unverified |

## Known limitations

1. **Platform**: Windows-specific implementation (PowerShell commands); macOS / Linux unverified.
2. **Profile restriction**: needs a profile with the Web UI (Desktop `desktop` or `dsh web`).
3. **The shell sandbox is `partial`**: on Windows it is implemented with an ACL restricted token and is best
   effort; **the filesystem sandbox is the hard denial**.
4. **Platform temp directories** stay writable under `workspace-write`, contained by the system prompt section.
5. **Child sessions cannot be opened as ordinary sessions** (`origin: 'subagent'`) — everything is viewed in the
   Isolation Pod panel.
6. **Multi-turn conversation does not cross processes**: after a host restart old tasks are view/export only.
7. **Log caps**: 500 entries per task in memory, 80 on disk; anything beyond that exists only in the child
   session log.
8. **Machine- and profile-local**: moving machines or profiles means placing the package and the patch row
   again.
9. **File preview has a hard cap**: one file ≤300 KB, and the panel shows at most 20000 characters at a time.
10. **The allowlist is an upper bound; the preset decides what exists**: ticking a tool the preset does not
    provide is not an error, but `隔离环境实有` will not list it and the call is rejected by the guard.
11. **Changing the Host half requires an app restart**: Node's ES module cache is keyed per URL.
12. **The token is only injected at page load or self-fetched**: Desktop has no reload entry, so when the token
    goes stale the panel fetches a new one first and reloads itself once.
13. **A drive-root sandbox skips the out-of-bounds probe**: a root like `E:\` has no parent outside it to probe,
    so the probe is skipped and flagged in the panel; use a subdirectory such as `E:\pod-work` to get it back.

## Development

### Layout

```
lib\index.js     Host half: Cordis plugin (`apply` / `inject` / `name`), engine, HTTP routes, persistence
lib\client.js    Client half: hand-written __ModuleLoader__ bundle registering sidebar.panellist and main
```

### What takes effect when

| Change | Takes effect |
|---|---|
| `lib/client.js` | **Hot** — a module-graph change is pushed to the page over `/plugins/events` and the new entry mounts on the spot |
| `lib/index.js` (Host half) | **Requires a DSH restart** — Node caches ES modules by URL, so a hot reload still yields the old module |
| `package.json` | After a restart (the Client half resolves through it) |
| the patch row (add / remove / edit) | **Hot** — `dsh-hmr` watches the profile patch; an inactive row only warns and never wedges startup |

To iterate on the Host half without restarting repeatedly, write the change to a **new filename** (for example
`lib\stage.js`) and point the patch row's `name` at it — that hot-loads. **Once verified, you must point the row
back at `lib\index.js` and delete the temporary file**; after pointing it back, the running process re-imports
the cached `index.js` (old code), so the final state still needs one restart to line up.

> Desktop note: release builds have **no** *Reload Page* menu (it is registered only under `development`). When
> a page really has to re-run its boot injections, quit and reopen the app; changing only `lib\client.js` does
> not need that.

### Debugging

- `/status`'s `build` / `pluginVersion` / `compat` confirm which version the current process actually loaded and
  what the interface adaptation concluded; every Host-half change should bump `BUILD` and surface it through
  `/status`.
- The panel proves itself: the task detail shows the sandbox mode, `越界写已被拒绝` ("out-of-bounds write
  denied", or the skipped-probe flag), the number of context messages, and the two tool-surface rows
  `可用工具` and `隔离环境实有`.
- The token channels can be verified on their own: `GET /isolation-pod/bootstrap` without a cookie must return
  401, and `POST /isolation-pod/api` without a token must return 403.
- The module graph and hot reload are observable:
  `curl.exe -s --max-time 5 http://127.0.0.1:19387/plugins/events` first emits one `graph` frame, and every
  subsequent Client-half change pushes a `rebuilt` frame.
- Child-session logs live in `<DSH_HOME>\sessions\--<encoded cwd>--\<childSessionId>\session.v4.jsonl.zstd` and
  are **multi-frame zstd** — `zstdDecompressSync` only yields the first frame, so you have to decompress frame
  by frame using the magic bytes.

### Release convention

1. after a code change, bump `PLUGIN_VERSION` and `BUILD` in `lib\index.js` (both should show up in `/status`);
2. keep `package.json`'s `version` and the new section in `CHANGELOG.md` in step;
3. prefix commit messages with `feat:` / `fix:` / `docs:` / `chore(release):` (following the existing history);
4. create and push an **annotated tag** `vX.Y.Z`, then create a Release of the same name (its body expands the
   matching CHANGELOG section).

## Related documents

- [`使用教程.md`](使用教程.md): a step-by-step walkthrough from zero (UI tour, first task, follow-up questions,
  return and export, troubleshooting, item-by-item acceptance).
- [`需求说明.md`](需求说明.md): the functional-specification baseline; for the deltas against the implementation
  see [Deltas from the specification](#deltas-from-the-specification).
- [`CHANGELOG.md`](CHANGELOG.md): version history.
