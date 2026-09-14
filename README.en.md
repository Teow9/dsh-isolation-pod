# Isolation Pod

> Runs sandboxed tasks outside the DSH main session. The main session stays **completely unaware** by default:
> no messages written, nothing added to the model context, no traces in the UI message stream. Returning a
> result and exporting files are both **manual, singly-authorized** actions.

**English** | [简体中文](README.md)

| | |
|---|---|
| Form | A local package plus one profile patch row (**not** a dynamic Cordis plugin — resident across restarts, no approval prompts) |
| Dependencies | None. The Host half imports `node:*` built-ins only |
| Platform | Windows (the current implementation shells out to PowerShell); requires a DSH profile with the Web UI |
| License | MIT |

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
- [Verified behaviour](#verified-behaviour)
- [Known limitations](#known-limitations)
- [Development](#development)
- [Related documents](#related-documents)
- [License](#license)

## Features

- **Zero traces in the main session** — the pod task runs in its own session and never writes to the main one.
  Only when you press *Return to main session* is **one** editable, condensed result injected.
- **The sandbox is enforced by the system** — read/write inside the sandbox root, **read-only** outside it.
  Out-of-bounds writes are *hard-denied* by the DSH file sandbox, not merely discouraged by a prompt.
  A pre-flight probe runs before every task and aborts it if the denial did not happen.
- **Tool allowlist is enforced** — any call outside the allowlist is rejected by the guard.
- **Return and export are independent** — neither triggers the other, and every export is authorized on its own.
- **Resident and approval-free** — loaded from a patch row at dsh startup; configuration and task history
  survive restarts without any approval card.
- **Multi-turn conversation** — the task detail view *is* a conversation; you can keep asking follow-ups
  (see [Multi-turn conversation](#multi-turn-conversation)).
- **Inspectable and cleanable** — transcript, tool calls, reasoning, and generated files all live in the panel;
  cleanup never touches the main session or anything outside the sandbox.

## How it works

### Form: a local package plus a profile patch row

```
<repo root>\                                      ← the repo root IS the package
  package.json                                      name = dsh-isolation-pod (also the browser module id)
  lib\index.js                                      Host half: engine + HTTP API + persistence
  lib\client.js                                     Client half: hand-written __ModuleLoader__ bundle (panel)
  README.md / README.en.md / 使用教程.md             documentation
  CHANGELOG.md / LICENSE

<DSH_HOME>\profiles\<profile>\cordis.patch.yml     ← the only external change (one insert row)
<DSH_HOME>\isolation-pod.json                      ← config, tasks and export records (runtime)
<DSH_HOME>\sessions\...                            ← the pod child session's own log (written by DSH)
```

dsh rewrites the **absolute path** in the patch row into a `file://` URL and mounts the Host half;
`dsh-client-modules` then walks up from that same file to `package.json`, reads `dsh.client`, and resolves
the browser half through `exports["./client"]`. **No bundler and no npm publish are involved.**

### Life of one task

1. The panel sends the task description to the Host half via `POST /isolation-pod/api`.
2. The Host half creates the sandbox directory and a **standalone child session**
   (`origin: 'subagent'`, cwd = sandbox root).
3. Inside that session's setup window it writes `sandbox/mode` and `approval/policy`, mounts the agent preset,
   and installs the tool guard and the isolation system-prompt section.
4. It runs a **pre-flight out-of-bounds write probe** and aborts unless the write was denied.
5. The task prompt (sandbox rules, allowlist, a read-only slice of the main session context) is delivered
   as one user message.
6. Every child-session event is folded into a transcript entry (user / assistant / tool / turn / reasoning)
   that the panel pulls incrementally.
7. The task settles in *completed* and waits for you: keep talking, return to the main session, export files,
   or clean up.

## Requirements

- **DSH** 0.1.x with a profile that has the Web UI (this plugin injects `webServer`).
- **OS**: Windows. Directory creation/removal and export run through PowerShell commands and have not been
  verified on macOS or Linux.
- **Node**: whatever DSH ships. The plugin itself has zero dependencies — no `npm install` needed.

## Installation

### 1. Get the package

```powershell
git clone https://github.com/Teow9/dsh-isolation-pod
```

No `npm install`, no build step.

### 2. Mount the patch row

Edit `<DSH_HOME>\profiles\<profile>\cordis.patch.yml` (`<DSH_HOME>` defaults to `%USERPROFILE%\.dsh`;
the file usually contains only comments and `[]`):

```yaml
- insert:
    - id: dsh-isolation-pod
      name: '<absolute path to this repo>\lib\index.js'
```

Saving applies the row (`dsh.profile.patchReload: "live"`); restarting dsh is the safer route.

> ⚠️ **`name` must be an absolute path** pointing at `lib\index.js` (the Host half).
> Do not append a query string such as `?v=2` — `fileURLToPath` rejects URLs with a search component.

> ⚠️ **This plugin only works in a profile with the Web UI.** The row injects `webServer`, so in a CLI/TUI
> profile it would never activate, and because dsh runs `assertEntriesActivated` at boot the result is that
> **dsh refuses to start**. Therefore:
> - add it to a specific Web profile, **never** to `<DSH_HOME>\cordis.patch.yml` (that applies to every profile);
> - if startup ever fails, roll the row back as described below.

### 3. Verify

With dsh running, hit the local diagnostic endpoint (no token required):

```powershell
curl.exe -s http://127.0.0.1:3080/isolation-pod/status
```

```json
{
  "ok": true,
  "build": 5,
  "tokenPrefix": "e0389378",
  "taskCount": 5,
  "storePath": "C:\\Users\\<you>\\.dsh\\isolation-pod.json",
  "sandbox": { "root": "E:\\pod-work", "liveSessions": [ { "id": "session-…", "origin": "", "cwd": "…", "insideSandbox": false } ] },
  "diagnostics": []
}
```

An **Isolation Pod** entry appearing in the sidebar means the install worked.

### Uninstall / rollback

Restore `cordis.patch.yml` to `[]`, or delete the file (a missing file means "no layer"), then restart dsh.

> Keep a `cordis.patch.yml.bak` copy before installing: **this row is on the boot-critical path.**

## Usage

### Entry point

One row in the sidebar, directly under *New session*: a shield icon plus the label. Clicking it switches the
centre column to the full-width pod panel, with four tabs: **Tasks / New / Config / Export history**.

> There is deliberately **no** entry at the sidebar foot (next to Settings): that row is shared with the
> built-in Cordis Plugin button, where a labelled or fixed-width button gets squeezed away — which is exactly
> how this project once produced a "button does not show up in the bottom-right corner" bug.

### First run: set the sandbox root

Open *Config* and enter an **absolute path** (for example `E:\pod-work`). Until it is set the pod refuses to
run any task, and it will **not** silently fall back to your workspace or project directory.

### Task lifecycle

New task (description, optional subdirectory) → start → watch the **conversation** and **generated files** in
the detail view → keep talking / return to the main session / export → clean up.
The main session receives nothing automatically while this happens.

### Multi-turn conversation

The bottom of the task detail view is an input box: **Enter sends, Shift+Enter inserts a newline**, and a
*Stop* button cancels the running turn.

- Follow-ups go through `followUp`, which posts another user message into the **same child session**. Sandbox
  mode, approval policy, tool guard and system prompt all hang off that resident child agent and are reused
  as-is — there is **no path where the isolation silently weakens on a follow-up**.
- The transcript renders by role: `Me` / `Isolation Pod` bubbles, `▶ ◀` tool rows, turn separators, an
  expandable **reasoning** block (`reasoning` content blocks), and the first turn's machine prompt collapsed
  into a "prompt sent this turn" block.
- **Continuity lasts for the process lifetime only.** The child agent lives in memory; after a dsh restart
  `canFollowUp` becomes false and the box says the session ended with the process. History stays readable and
  exportable. (Re-attaching after a restart is explicitly out of scope for now.)

> `需求说明.md` (the Chinese requirements spec) only describes one-shot tasks; **multi-turn conversation is an
> addition on top of that spec**. Everything else follows it.

### Return to the main session

In the *Return to main session* block you can attach one file path, press *Generate preview* to get a text
block, **edit it freely**, and only then press *Confirm return*. That text is delivered as a single message.
By default nothing is returned.

### Export to the workspace

Select generated files → enter an **absolute target directory outside the sandbox** → choose the mode
(copy / move) and the conflict policy (overwrite / skip / rename) → press *Export* → confirm again in the
confirmation card. Every export is confirmed on its own; there is no standing authorization. Enabling
`allowRememberChoice` merely pre-fills the path — you still confirm each time. Copy-mode exports can be undone
from the export history.

### Cleanup

- **Delete task files** — removes that task's sandbox directory (refuses to delete the sandbox root itself).
- **Clean up record and files** — also drops the record and releases the resident agent.
- Neither touches the main session or anything outside the sandbox.

## Configuration

Edited in the *Config* tab and persisted to `<DSH_HOME>\isolation-pod.json`.

| Key | Default | Meaning |
|---|---|---|
| `sandboxRoot` | `''` | Sandbox root (absolute path). Empty means tasks are refused |
| `allowWrites` | `true` | When off, the child session runs in `read-only` mode |
| `allowedTools` | `pwsh, read, write, edit, glob, grep` | Tool allowlist, enforced by the guard |
| `timeoutMs` | `600000` | Timeout **per turn** (ms); the turn is cancelled and marked `timeout` |
| `readContext` | `true` | Inject the last few main-session messages as **read-only** background |
| `maxConcurrent` | `3` | Maximum simultaneously running tasks |
| `enableExport` | `true` | When off, `exportEntries` refuses outright |
| `allowRememberChoice` | `false` | Whether the export dialog may offer "remember this choice" |
| `presetId` | `'standard'` | Agent preset mounted into the child session; empty means no preset |

## HTTP interface

The Host half registers the prefix route `/isolation-pod` on the Web server.

| Route | Auth | Purpose |
|---|---|---|
| `GET /isolation-pod/status` | none | Local diagnostics: `build`, `tokenPrefix`, `taskCount`, `storePath`, `sandbox.liveSessions`, `diagnostics` |
| `POST /isolation-pod/api` | `x-ipp-token` header | Single JSON entry point: `{ "method": "...", "args": { ... } }` |

The token is a UUID generated **once per process start**, injected by the Host half into `index.html`
(`window.__DSH_IPP__`) and read by the panel from there. It is never written to disk; a failed check returns `403`.

| Method | Purpose |
|---|---|
| `getState` / `setConfig` | Read panel state (pass `{ mainSessionId }` so the sandbox-in-workspace warning can be answered for the **current** session) / write configuration |
| `startTask` / `getTask` / `cancelTask` / `followUp` | Create a task (returns `taskId`) / incrementally pull task + transcript (`fromLogIndex`) / cancel the current turn / continue the conversation |
| `listFiles` / `readSandboxFile` | Sandbox file listing / read text (≤300 KB, truncated to 4000 chars by default) |
| `previewReturn` / `returnToMain` | Build the return preview text / inject it into the main session |
| `exportEntries` / `listExports` / `undoExport` | Export to the workspace / export history / undo a copy-mode export |
| `cleanup` | `scope`: `record` \| `files` \| `all` |

## Data and file layout

- **State file**: `<DSH_HOME>\isolation-pod.json` (`~/.dsh` when `DSH_HOME` is unset).
  `version: 1`, written with a temp-file + rename atomic swap, debounced 800 ms.
- **Sandbox directory**: `<sandboxRoot>\<taskId>\`, or `<sandboxRoot>\<subdir>\` when a subdirectory was given.
- **Caps**: 200 task records, 200 export records, 500 in-memory transcript entries per task;
  the on-disk mirror keeps the last 80 (each text capped at 400 chars).
- **On restart**: tasks still `running` / `queued` are marked `interrupted` (their agent died with the process).
- **Transcript backfill**: when a task's local log copy is missing, `getTask` re-reads the child session's own
  persisted log through `sessionQuery.readSession(childSessionId)` and re-summarizes it.
- **File preview**: `readSandboxFile` returns the text of one file inside the task directory
  (≤300 KB on disk, `maxChars` clamped to 20000); the panel shows it in a collapsible pane.

## Isolation and permission model

| Layer | Mechanism | Effect |
|---|---|---|
| Filesystem | child session `sandbox/mode = workspace-write`, cwd = sandbox root | writable inside the root, **hard-denied outside** (`FS_SANDBOX_DENIED`) |
| Approval | child session `approval/policy = never` | operations inside the pod never raise an approval prompt |
| Tools | `tools.guard()` (authoritative) + `tools.restrict()` (best effort) | calls outside the allowlist are rejected; `write`/`edit` get an extra path-ownership check |
| Pre-flight | out-of-bounds write probe before every task | if the write was *not* denied the task is aborted — it never runs with a dead sandbox |
| Prompt | injected `isolation-pod/rules` system section | tells the model where it may write, which tools it has, and where outputs go |
| Main-session boundary | standalone child session (no parent agent) | writes no events to the main session; the only entry is a manual `returnToMain` |

## Verified behaviour

- Out-of-bounds writes are **hard-denied by the system**: tasks only start after the probe records `fsDenied: true`.
- The tool allowlist is enforced by the **guard** (`restrict` cannot remove scoped registrations, so it is only a supplement).
- **Zero traces in the main session**: across CSV generation and a 3-turn conversation, the main workspace gained
  no files and the main session received no automatic messages.
- **Configuration, tasks and export records survive restarts**; still-running tasks are marked `interrupted`.
- **Transcripts survive restarts**: the log is persisted with the state, and is backfilled from the child
  session log when needed (measured: 31 child-session records → 14 transcript entries, matching an independent
  decompression).
- **Multi-turn conversation within one process**: `followUp` reuses the same resident child agent and `turns`
  increments (measured: 3 turns, 25 transcript entries).
- **Token self-healing**: after a dsh restart an already-open page holds a stale token; on `403` the client
  re-fetches the same-origin `/`, parses the new token and retries once, so **no page refresh is needed**.
  A genuine failure shows an error banner instead of an eternal "loading".
- **The warning is answered for the current session only**: the panel warns that pod files will be visible in
  your workspace *only* when the sandbox root sits inside the workspace of **the session you are looking at**;
  `/status` exposes `sandbox.liveSessions` so the verdict can be checked from outside.

## Known limitations

1. **Platform**: Windows-specific implementation (PowerShell commands); macOS / Linux unverified.
2. **Profile**: needs a Web-UI profile; cannot go into the home-level patch without affecting other profiles.
3. **Shell sandbox is `partial`** on Windows (ACL restricted token); only the filesystem sandbox is a hard denial.
4. **Platform temp directories** stay writable under `workspace-write`; contained by the system prompt.
5. **Pod sessions cannot be opened as ordinary sessions** (`origin: 'subagent'`) — everything is viewed in the panel.
6. **Multi-turn conversation does not cross processes**: after a restart old tasks are view/export only.
7. **Log caps**: 500 entries per task in memory, 80 on disk; the rest exists only in the child session log.
8. **Machine- and profile-local**: moving machines or profiles means placing the package and patch row again.

## Development

### Layout

```
lib\index.js     Host half: Cordis plugin (`apply` / `inject` / `name`), engine, HTTP routes, persistence
lib\client.js    Client half: hand-written __ModuleLoader__ bundle registering sidebar.panellist and main
```

### What takes effect when

| Change | Takes effect |
|---|---|
| `lib/client.js` | **Hot** — the browser bundle is re-read from disk and `dsh-client-hmr` pushes a reload |
| `lib/index.js` (Host half) | **Requires a dsh restart** — Node caches ES modules by URL, so editing a file in place still yields the old module |
| `package.json` | After a restart (the browser half resolves through it) |

To iterate on the Host half without restarting, write the change to a **new filename** (e.g. `lib\stage.js`) and
point the patch row's `name` at it — that hot-loads. **Always point the row back at `lib\index.js` and delete
the temporary file afterwards.** Note that after pointing it back, the running process re-imports the cached
`index.js` (old code), so a final restart is still needed to align everything.

### Debugging

- `GET /isolation-pod/status` reports a `build` marker bumped on every Host-half change.
- The panel proves itself: the task detail shows the sandbox mode, *out-of-bounds write denied*, the number of
  context messages, and the effective tool list.
- Child-session logs live in `<DSH_HOME>\sessions\--<encoded cwd>--\<sessionId>\session.v3.jsonl.zstd` and are
  **multi-frame zstd** — `zstdDecompressSync` only yields the first frame (the session header); decompress frame
  by frame using the magic bytes.

## Related documents

- `使用教程.md` — a step-by-step walkthrough (Chinese): UI tour, first task, follow-ups, return/export, troubleshooting, acceptance checklist.
- `需求说明.md` — the functional requirements spec (Chinese, behaviour only, no implementation).
- `CHANGELOG.md` — version history, [Keep a Changelog](https://keepachangelog.com/) style.

## License

MIT — see [`LICENSE`](LICENSE).
