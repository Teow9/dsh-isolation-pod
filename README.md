# 隔离舱 Isolation Pod

> 在 DSH 主会话之外运行受沙箱约束的隔离任务。主会话默认**完全无感**：不写入消息、不进入模型上下文、
> 界面消息流里没有任何痕迹；结果返回与文件导出都必须由用户**手动确认**。

**English** — A resident DSH plugin that runs sandboxed tasks outside the main session. The main session stays
unaware by default; returning a result or exporting files is manual-only and singly authorized.

**简体中文** | [English](README.en.md)

| | |
|---|---|
| 版本 | 0.1.2（适配 DSH **0.1.7**） |
| 形态 | 本地包 + profile patch 行（**不是**动态 Cordis 插件；随宿主常驻，不出现审批卡片） |
| 依赖 | 零 npm 依赖；Host 半只使用 `node:*` 内建模块，无构建步骤 |
| 平台 | Windows（当前实现调用 PowerShell）；桌面版 `desktop` profile 与 `dsh web` 均已适配 |
| 许可 | MIT |

## 目录

- [特性](#特性)
- [工作原理](#工作原理)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [配置项](#配置项)
- [HTTP 接口](#http-接口)
- [数据与文件布局](#数据与文件布局)
- [隔离与权限模型](#隔离与权限模型)
- [桌面版差异](#桌面版差异)
- [已验证的行为](#已验证的行为)
- [规格与本实现的差异](#规格与本实现的差异)
- [已知限制](#已知限制)
- [开发](#开发)
- [相关文档](#相关文档)
- [许可](#许可)

## 特性

- **主会话零痕迹**：隔离任务在独立子会话中运行，全程不向主会话写入任何内容；只有你手动点「返回主会话」，
  才会注入**一条**可编辑的精简结果。
- **沙箱是系统级强制**：沙箱根目录内可读写，根目录外**只能读**；越界写入由 DSH 文件沙箱**硬拒绝**
  （`FS_SANDBOX_DENIED`），不靠提示词自觉。任务启动前还有一次越界写自检，未被拒绝就中止任务。
- **工具白名单强制生效**：白名单以外的工具调用被 `tools.guard()` 直接打回；白名单本身按 pod 的真实工具面收敛。
- **结果返回与文件导出互相独立**：两者不自动触发；导出默认单次授权，每次都要重新确认。
- **常驻且免审批**：作为 patch 行随宿主加载，配置与任务记录跨重启存活，隔离环境内不会弹出审批。
- **多轮对话**：任务详情即对话视图，可就同一会话继续追问（见[多轮对话](#多轮对话)）。
- **执行记录可查、可清**：对话转写、工具调用、思考过程、生成文件清单都在面板内，文件内容可就地预览；
  清理不影响主会话，也不触碰沙箱之外的文件。

## 工作原理

### 形态：本地包 + profile patch 行

```
<仓库根目录>\                                   ← 仓库根就是插件包
  package.json                                    name = dsh-isolation-pod（同时是浏览器模块 id）
  lib\index.js                                    Host 半：执行引擎 + HTTP API + 持久化
  lib\client.js                                   Client 半：手写 __ModuleLoader__ bundle（侧边栏面板）
  README.md / README.en.md                        本文件与英文版
  使用教程.md                                     从零上手的分步走查
  需求说明.md                                     功能需求规格（不含实现方案）

<DSH_HOME>\profiles\<profile>\cordis.patch.yml    ← 唯一的外部改动（追加一项 insert）
                                                  桌面版为 profiles\desktop\
<DSH_HOME>\isolation-pod.json                     ← 配置、任务与导出记录（运行期生成）
<DSH_HOME>\sessions\...                           ← 隔离子会话自己的会话日志（DSH 负责落盘）
```

宿主把 patch 行里的**绝对路径**改写为 `file://` URL 挂载 Host 半；`dsh-client-modules` 再从同一文件
向上找到最近的 `package.json`，读 `dsh.client`，按 `exports["./client"]` 解析出浏览器半。
**整个链路不需要打包器，也不需要 npm 发布。**

### 一次任务的执行路径

1. 面板把「任务描述」经 `POST /isolation-pod/api` 交给 Host 半；
2. Host 半创建沙箱目录，并创建一个**独立子会话**（`origin: 'subagent'`，cwd = 沙箱根目录）；
3. 在该子的 setup 窗口内写入 `sandbox/mode` 与 `approval/policy`，挂载 agent preset，
   然后按 pod 的真实工具面收敛白名单、装上工具 guard 与系统提示词；
4. 先跑一次**越界写自检**，确认沙箱外写入确实被拒绝，否则中止任务；
5. 把任务提示（含沙箱规则、白名单、只读的主会话上下文片段）作为一条用户消息送入子会话；
6. 子会话的每个事件被折叠成转写条目（用户 / 助手 / 工具 / 轮次 / 思考），面板增量拉取展示；
7. 结束后停在「已完成」，等待你决定：继续对话、返回主会话、导出文件，或清理。

### 与宿主的接口约定（0.1.7）

Host 半只依赖 DSH 的公开服务，不 import 任何 `@deepseek-ai/*` 包（插件在 dsh 安装目录之外，
裸包名无法解析）。关键接口与适配结论：

| 接口 | 0.1.7 的实际形态 | 本插件如何处理 |
|---|---|---|
| 子会话 | `ctx.agents.create({ sessionId, meta, agentOptions, setup })` | 直接使用；`meta = { cwd: 沙箱根目录, origin: 'subagent' }` |
| 会话内策略 | `session.append('sandbox/mode' \| 'approval/policy', …)` | 直接使用（`sandbox/mode` 的折叠只读 `data.mode`） |
| 工具面 | 宿主面按 preset 分层；Windows 上只有 `pwsh`，没有 `bash` | 挂载 preset 后读 `agentCtx.tools.schemas()`，与配置白名单求交 |
| 工具拦截 | `tools.guard(fn)` 权威；`tools.restrict({ allow })` 对未知名字会抛错 | guard 为准；`restrict` 只传本 pod 确实存在的名字，且整体 try/catch |
| 沙箱判定 | `ctx.sandboxPolicy.resolve({ session })` → `{ mode, workspaceRoot }` | 自检据此确认模式与可写根 |
| 进程内命令 | `ctx.shell.resolve(req)` + `execute(spec)` → 句柄 `.result()` | 探测 `execute`，无则回退 `shell.run`；`/status.compat.shellApi` 报告结论 |
| 页面注入 | 结构化行 `webserver/index-inject`（桌面版经 IPC 交付） | 用 `{ kind: 'global' }` 行投递令牌，**不用** `tapIndex`（桌面版不执行 tap） |
| 会话列表快照 | 无 `current` 字段，用 `retainedBy.mainView` 表示主视图正在看的会话 | 面板按该字段解析主会话，保留旧字段兜底 |
| 消息来源 | `user \| model \| tool \| system-prompt` 闭合联合 | `followup` 一律用 `{ kind: 'user' }` |
| 启动审计 | 只有固定必需集合（`agent-loop`、`webserver`、`modules`、`connection` 等）未激活才拒绝启动 | 不依赖该保护；插件注册全部包 try/catch 并记入 `diagnostics` |
| 兼容性门禁 | 仅当插件声明 `peerDependencies` 时评估 | **不声明** DSH peer，避免被版本门禁挡住 |

## 环境要求

- **DSH 0.1.7**（含桌面版 Desktop 0.1.7-rc.2）。桌面版的 `desktop` profile 由
  `dsh-base` + `dsh-web-app` 组成，与 `dsh web` 同构，因此两者共用同一份 profile patch 与同一套服务。
- **操作系统**：Windows。目录创建/删除/导出走 PowerShell 命令（`ctx.shell`），未在 macOS / Linux 验证。
- **Node**：随 DSH 提供。插件零依赖，不需要 `npm install`，也没有构建步骤。

## 安装

### 1. 取得包

```powershell
git clone https://github.com/Teow9/dsh-isolation-pod
```

### 2. 挂载 patch 行

编辑 `<DSH_HOME>\profiles\<profile>\cordis.patch.yml`（`<DSH_HOME>` 默认 `%USERPROFILE%\.dsh`；
**桌面版**用 `profiles\desktop\cordis.patch.yml`）。该文件通常只有注释与若干 id 定向条目，
在数组**末尾追加**一项即可：

```yaml
- insert:
    - id: dsh-isolation-pod
      name: '<仓库绝对路径>\lib\index.js'
```

保存即生效：

- **Host 半当场激活**——`dsh-hmr` 监听 profile patch；
- **客户端入口自动挂载**——`dsh-client-modules` 重组模块图后经 `/plugins/events` 推给页面，
  侧边栏随即出现「隔离舱」，**不需要刷新页面，也不需要重启应用**。

> ⚠️ **`name` 必须是绝对路径**并指向 `lib\index.js`（Host 半）。不要加 `?v=2` 之类的查询串：
> `fileURLToPath` 不接受带 search 的 URL。也不要在 `lib\` 下再放 `package.json`：
> 客户端半靠「向上找到最近的那个 `package.json`」解析。

> ℹ️ **写在具体 profile 里，不要写进 `<DSH_HOME>\cordis.patch.yml`。** 后者作用于**所有** profile，
> 而 CLI/TUI profile 没有 `webServer`，那一行只会一直处于「等待服务」的未激活状态。
> DSH 0.1.7 对此只打印一条 warning（只有内置必需插件未激活才会拒绝启动），但那条告警没有意义。

> ℹ️ `dsh-hmr` 只热重载 **profile patch** 与客户端半；`lib\index.js` 被 Node 按 URL 缓存，
> **改完 Host 半必须重启应用**（详见[改动生效规则](#改动生效规则)）。

### 3. 验证

宿主起来后访问本地诊断端点（**无需令牌**）：

```powershell
# 桌面版：dsh-desktop-host 固定监听 19387
curl.exe -s http://127.0.0.1:19387/isolation-pod/status
# dsh web：默认 3080，以启动时打印的 URL 为准
curl.exe -s http://127.0.0.1:3080/isolation-pod/status
```

```json
{
  "ok": true,
  "build": 7,
  "pluginVersion": "0.1.2",
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

`compat` 是版本适配自检：

| 字段 | 期望 | 含义 |
|---|---|---|
| `shellApi` | `execute` | 用的是 0.1.7 的 `ctx.shell.execute()`；若为 `run` 说明回退到旧接口，`missing` 说明该服务不可读 |
| `indexInject` | `true` | 令牌的结构化索引注入行已注册 |
| `bootstrap` | `true` | `/isolation-pod/bootstrap` 令牌通道可用（依赖 `connection` 服务） |

侧边栏出现「隔离舱」入口即安装成功。若面板提示令牌不可用，说明该页面早于插件加载：
面板会先取 `/isolation-pod/bootstrap`，再自动重新载入一次；仍失败请退出并重新打开应用
（release 版桌面没有「刷新页面」菜单）。

### 卸载 / 回滚

删掉 patch 文件里那一项 `- insert:`，保存即热卸载（HTTP 路由消失、常驻 Agent 释放、状态落盘）。
要彻底移除就删除该文件或还原最初内容（文件缺失 = 该 layer 不存在）。

> 安装前建议复制一份 `cordis.patch.yml.bak`。0.1.7 下未激活的插件行只会告警、不会锁死启动，
> 但有一份备份意味着回滚只需一步。

## 使用

### 入口

侧边栏「新会话」下方的一行：盾牌图标 + 「隔离舱」。侧边栏收起成窄栏时只显示图标。点击后中栏切换为
隔离舱全宽面板，页签为 **任务 / 新建 / 配置 / 导出记录**。

> 侧边栏底部（设置旁）**刻意不放**入口：那一行与内置的 Cordis Plugin 按钮共用，放带文字或固定宽度的
> 按钮会被挤没——本项目早期正是这样出现过「右下角显示不出来」。

### 首次使用：指定沙箱根目录

到「配置」页填入**绝对路径**（例如 `E:\pod-work`）。未配置时隔离舱会拒绝执行任何任务，
并且**不会**自动退回使用工作区或项目目录。

同页还有 **Agent preset**（可用时显示为下拉框）：隔离 Agent 的工具**全部**来自 preset。
选错 preset 会导致白名单里的工具一个都不存在，因此任务详情会同时列出
「可用工具」（收敛后的白名单）与「隔离环境实有」（preset 实际提供的工具面）以便对账。

### 任务生命周期

新建（填描述，可选子目录）→ 启动 → 在详情页看**对话**与**生成文件** →
继续对话 / 返回主会话 / 导出到工作区 → 清理。主会话在此期间不会收到任何自动消息。

### 多轮对话

任务详情页底部是输入框：**回车发送，Shift+回车换行**，运行中可「停止」。

- 续聊走 `followUp`，往**同一个子会话**再发一条用户消息；沙箱模式、审批策略、工具 guard、系统提示词
  都挂在常驻子 Agent 上原样复用，**不存在"续聊时隔离失效"的路径**。
- 转写稿按角色渲染：`我` / `隔离舱` 气泡、`▶ ◀` 工具行、轮次分隔线；助手条目里可展开
  **思考过程**（模型的 `reasoning` 块），首轮那条机器指令折叠为「本轮发给隔离舱的指令」。
- **连续性仅在进程内有效**：子 Agent 常驻内存，宿主重启后 `canFollowUp` 变为 false，
  输入框会注明「该会话已随进程结束」；历史仍可查看与导出。（明确不做重启后重挂。）

> `需求说明.md` 只描述一次性「执行任务」，没有多轮语义——**多轮对话是本实现相对需求的增量**。

### 返回主会话

详情页「返回主会话」区块：可附带一个文件路径，点「生成预览」得到一段文本，**该文本可以自由编辑**，
点「确认返回主会话」后才以一条消息注入主会话。默认不返回任何内容。

### 导出到工作区

选择生成文件 → 指定**沙箱之外**的绝对目标目录 → 选择方式（复制 / 移动）与冲突策略（覆盖 / 跳过 / 重命名）
→ 点「导出到工作区」→ 在确认块里再次确认。每次导出都要重新确认，不存在自动延续的授权；
`allowRememberChoice` 打开后也仅预填路径，仍需确认。复制模式下可「撤销此次导出」。

### 清理

- **删除任务文件**：删除该任务的沙箱目录（拒绝删除沙箱根目录本身）。
- **清理任务记录与文件**：同时移除记录、释放该会话的常驻 Agent。
- 两者都**不触碰**主会话与沙箱之外的任何文件。

## 配置项

在「配置」页修改，落到 `<DSH_HOME>\isolation-pod.json`。

| 键 | 默认值 | 说明 |
|---|---|---|
| `sandboxRoot` | `''` | 沙箱根目录（绝对路径）。为空时拒绝执行任务 |
| `allowWrites` | `true` | 关掉后子会话以 `read-only` 模式运行 |
| `allowedTools` | `pwsh, read, write, edit, glob, grep` | 工具白名单；运行时再与 pod 实际工具面求交 |
| `timeoutMs` | `600000` | **每轮**对话的超时（毫秒），取值被夹在 30 000–7 200 000 之间；超时取消该轮并标记 `timeout` |
| `readContext` | `true` | 是否把主会话最近若干条消息作为**只读**背景注入任务提示 |
| `maxConcurrent` | `3` | 同时运行的任务数上限（1–8） |
| `enableExport` | `true` | 关闭后 `exportEntries` 直接拒绝 |
| `allowRememberChoice` | `false` | 是否允许导出时勾选「记住本次选择」（仅预填路径） |
| `presetId` | `'standard'` | 在子会话里挂载的 agent preset id；空串表示不挂载（此时 pod 没有任何工具） |

## HTTP 接口

Host 半在 Web 服务上注册了前缀路由 `/isolation-pod`。

| 路由 | 认证 | 说明 |
|---|---|---|
| `GET /isolation-pod/status` | 无 | 本地诊断：`build`、`pluginVersion`、`tokenPrefix`、`taskCount`、`storePath`、`sandbox.liveSessions`、`compat`、`diagnostics` |
| `GET /isolation-pod/bootstrap` | harness 浏览器认证 | 只对**已被 harness 认证**的会话返回 `{ token }`；供页面加载后才挂载的面板取令牌（桌面版首次安装即此路径），否则 `401` |
| `POST /isolation-pod/api` | `x-ipp-token` 头 | JSON 单入口：`{ "method": "...", "args": { ... } }` |

令牌是**每次激活随机生成**的 UUID，作为结构化索引注入行
（`webserver/index-inject` → `{ kind: 'global', name: '__DSH_IPP__' }`）交付：
Web 版渲染进 HTML，桌面版经 IPC 交给渲染进程。令牌不写磁盘；校验失败返回 `403`。

`bootstrap` 的放行条件是 `ctx.connection.requestRejection(req) === undefined`，即
「Host/Origin 围栏通过」且「带有与本次启动匹配的浏览器 cookie」。桌面版转发页面请求时会带上该 cookie
并剥掉 `Origin`，所以面板可以自取令牌；没有 `connection` 服务的部署返回 `401`，面板退回其它取令牌路径。

`method` 一览（共 14 个）：

| 方法 | 作用 |
|---|---|
| `getState` / `setConfig` | 读取面板状态（含 `presetChoices`，并用 `{ mainSessionId }` 判定沙箱是否落在**当前会话**工作区内）/ 写入配置 |
| `startTask` / `getTask` / `cancelTask` / `followUp` | 新建任务（取回 `taskId`）/ 增量拉取任务与转写（`fromLogIndex`）/ 取消当前轮 / 继续对话 |
| `listFiles` / `readSandboxFile` | 沙箱文件清单（深度 ≤6、最多 1500 项）/ 读取文本（单文件 ≤300 KB，`maxChars` 夹在 200–20000，默认 4000） |
| `previewReturn` / `returnToMain` | 生成返回预览文本（≤4000 字，超出截断）/ 注入主会话（≤8000 字） |
| `exportEntries` / `listExports` / `undoExport` | 导出到工作区 / 导出记录 / 撤销复制模式的导出 |
| `cleanup` | `scope`: `record` \| `files` \| `all` |

## 数据与文件布局

- **状态文件**：`<DSH_HOME>\isolation-pod.json`（`DSH_HOME` 未设置时用 `~/.dsh`）。
  `version: 1`，写入采用「临时文件 + rename」原子替换，变更后 800 ms 防抖落盘。
- **沙箱目录**：`<sandboxRoot>\<任务ID>\`；新建时指定了子目录则用 `<sandboxRoot>\<子目录>\`。
- **容量上限**：任务记录 200 条、导出记录 200 条、每任务内存执行日志 500 条；
  落盘镜像保留最近 80 条（单条文本截断 400 字），任务可用工具面最多记 80 个。
- **重启处理**：激活时仍在 `running` / `queued` 的任务被标记为 `interrupted`（其 Agent 已随进程消失）。
- **执行记录回填**：若某任务的本地日志副本缺失，`getTask` 会用 `sessionQuery.readSession(子会话ID)`
  从子会话自己的落盘日志读回并重新汇总。
- **只读上下文**：`readContext` 开启时取主会话最近 12 条消息（用户 700 字 / 助手 900 字，合计 ≤12000 字）
  拼进任务提示。

## 隔离与权限模型

| 层 | 手段 | 效果 |
|---|---|---|
| 文件系统 | 子会话 `sandbox/mode = workspace-write`，cwd = 沙箱根目录 | 根目录内可读写，**根目录外硬拒绝**（`FS_SANDBOX_DENIED`） |
| 审批 | 子会话 `approval/policy = never` | 隔离环境内的操作不需要、也不会弹出审批 |
| 工具 | `tools.guard()`（权威）+ `tools.restrict()`（尽力而为） | 白名单外的工具调用被打回；`write`/`edit` 再叠加一次路径归属校验 |
| 预检 | 任务启动前的越界写探针 | 沙箱外写入**没有被拒绝**就中止任务，绝不带着失效的沙箱开跑 |
| 提示词 | 注入 `isolation-pod/rules` 系统提示段 | 让模型知道可写范围、可用工具与输出目录 |
| 主会话边界 | 独立子会话（无父 Agent） | 不向主会话写入任何事件；唯一入口是用户手动的 `returnToMain` |

可写根由 `writableRoots(policy)` 决定：沙箱根目录、`/tmp` 与平台临时目录。平台临时目录在
`workspace-write` 下仍可写，靠系统提示词收敛。

预检探针落在**沙箱根目录的上一级**（例如 `E:\pod-work` → 探 `E:\__ipp_probe_*.txt`），
因此配置里的根目录会先归一化（去掉尾部反斜杠）；若根目录本身就是盘符根（如 `E:\`），
没有更上一级可探，自检会被跳过并在面板上标注——写入仍由文件沙箱在每次调用时硬拒绝。

## 桌面版差异

桌面版不是另一套插件 API：`dsh-desktop-host` 在本机拉起**同一个** Web 宿主
（`dsh-base` + `dsh-web-app`，固定 `127.0.0.1:19387`），所以 profile patch、服务名、HTTP 路由、
沙箱与审批语义都与 `dsh web` 一致。差异只在**页面怎么来**：

| | `dsh web` | 桌面版 |
|---|---|---|
| 页面来源 | `webServer` 的 SPA 回退（`renderIndex`：先渲染结构化注入行，再跑 `tapIndex`） | Electron 的 `dsh-app://app/`，索引由 `serveWebDocument` 直接发文件 |
| 注入怎么进页面 | 宿主渲染时写进 HTML | 宿主通过 IPC 把**结构化行**交给渲染进程，页面启动时套用 |
| 结论 | — | `tapIndex` 在桌面版**永远不会执行**，因此令牌改用 `webserver/index-inject` 的 `{ kind: 'global' }` 行 |

另外三点：

1. **相对路径可用**：页面发出的 `/isolation-pod/api` 会解析成 `dsh-app://app/…`，
   由 Electron 带着宿主 cookie 转发，因此面板不需要知道端口，也不需要 CORS。
2. **release 版没有「刷新页面」入口**：重载菜单项只在开发构建里注册，也没有快捷键。所以令牌的
   （重）获取不能指望用户手动刷新：面板依次尝试 `window.__DSH_IPP__`（随页面加载注入）→
   `GET /isolation-pod/bootstrap`（由 harness 自身的浏览器认证放行）→ 抓同源 `/` 的 HTML（Web 路径）
   → 单次自动重载。首次安装时客户端半是被模块图推送**热挂载**的，走的正是第 2 条，通常什么都不用做。
3. **改 Host 半要重启应用**：Node 按 URL 缓存 ES 模块，改完 `lib\index.js` 后热重载拿到的仍是旧代码。

## 已验证的行为

分两组：**(A)** 是 v0.1.2 在桌面版 0.1.7 上**本次实测**的结论；**(B)** 是 v0.1.1 在 Web 版上的历史实测，
0.1.7 上尚未逐条复测（代码路径已按接口核对，但结论仍以旧版为准）。

**(A) v0.1.2 · 桌面版 0.1.7 实测**

- **热安装**：把 patch 行追加进 `profiles\desktop\cordis.patch.yml` 后，Host 半当场激活
  （`/status` 返回 `pluginVersion: "0.1.2"`、`compat.shellApi: "execute"`），**不需要重启应用**。
- **客户端半热挂载**：模块图重组后经 `/plugins/events` 推送，页面自动注册
  `sidebar.panellist`（`isolation-pod`，order 60）与 `main`（`isolation-pod`），**不需要刷新页面**
  （实机核对 Slot 占用者，并观察到 `rebuilt` 帧把 graph rev 从 `4b496526c519` 推到 `38808638bf84`）。
- **热卸载**：把该行改为 `disabled: true` 后 HTTP 路由立刻消失（`/status` → 404）、
  常驻 Agent 释放、状态落盘；改回即可重新激活。
- **令牌链路在桌面版可用且能自愈**：客户端半被热挂载时页面上没有 `__DSH_IPP__`，
  它经 `/isolation-pod/bootstrap` 取到令牌，面板正常渲染（无错误横幅、`getState` 数据可见）。
- **令牌通道默认关闭**：无 cookie 访问 `/isolation-pod/bootstrap` → `401`；
  无 `x-ipp-token` 访问 `/isolation-pod/api` → `403`。
- **主会话识别**：面板按 `retainedBy.mainView` 解析出主会话，不再显示「未定位到主会话」。
- **告警判定只针对当前会话**：只有当沙箱根目录落在**你正在看的这个会话**的工作区内时，面板才提示
  「隔离任务生成的文件会出现在你看到的工作区里」；`/status` 的 `sandbox.liveSessions` 可外部核验该判定。

**(B) v0.1.1 · Web 版实测（0.1.7 未复测）**

- 沙箱外写入被**系统强制拒绝**：运行时自检记录 `fsDenied: true` 后才放行任务。
- 工具白名单由 **guard** 强制执行（`restrict` 无法移除 scoped 注册，因此仅作补充）。
- **主会话零痕迹**：实测生成 CSV、跨 3 轮对话等任务全程，主会话工作区无任何新增文件、无自动消息。
- **配置、任务与导出记录跨重启存活**；仍在运行的任务被正确标记为 `interrupted`。
- **执行记录不因重启丢失**：日志随状态落盘；必要时从子会话日志回填
  （实测：31 条子会话记录 → 14 条转写条目，与独立解压预测一致）。
- **进程内多轮对话**：`followUp` 复用同一常驻子 Agent，`turns` 逐轮累加（实测 3 轮、25 条转写）。

> 任务执行链路（建目录 → 越界写自检 → 转写 → 产物 → 导出/撤销）在 0.1.7 上的复测**尚未完成**；
> 完成后会把结论并入 (A) 组。

## 规格与本实现的差异

`需求说明.md` 是功能规格，下列差异是**有意为之**或平台限定，逐条列出以便对账：

| 规格 | 实现 | 说明 |
|---|---|---|
| 未描述多轮对话 | 支持（`followUp`） | 本实现相对规格的增量，规格只描述一次性任务 |
| §4.11.3「清理某个任务**或整个沙箱**」 | 只提供按任务清理 | 沙箱根目录本身受保护（拒绝删除），避免一次误操作清空你指定的整棵目录树 |
| §4.7.16「导出应当可以取消或撤销」 | 仅**复制**模式的导出可撤销 | 「移动」已把源文件移走，撤销无法还原，因此按钮不提供 |
| §4.8 未列出并发与 preset | 增加 `maxConcurrent`、`presetId` | preset 是 0.1.7 提供工具面的唯一途径，属于宿主结构而非插件选项 |
| 未限定平台 | 仅 Windows | 目录创建/删除/导出走 PowerShell；macOS / Linux 未验证 |
| §4.3.5 工具白名单 | 配置白名单 ∩ pod 真实工具面 | 目的相同（未授权不得调用），并额外把「preset 不提供的工具」也排除掉 |

## 已知限制

1. **平台**：Windows 专有实现（PowerShell 命令）；macOS / Linux 未验证。
2. **profile 限定**：需要带 Web UI 的 profile（桌面版 `desktop` 或 `dsh web`）；
   写进 home 级 patch 不会报错，但在 CLI/TUI profile 里只会留下一条无意义的未激活告警。
3. **shell 沙箱是 `partial`**：Windows 上用 ACL 受限令牌实现，属尽力而为；**文件系统沙箱才是硬拒绝**。
4. **平台临时目录**在 `workspace-write` 下仍可写，靠系统提示词收敛。
5. **隔离会话不能当普通会话打开**（`origin: 'subagent'`），一切查看都在隔离舱面板内。
6. **多轮对话不跨进程**：宿主重启后旧任务只能查看 / 导出。
7. **日志上限**：内存 500 条 / 任务，落盘 80 条 / 任务，超出部分只存在于子会话日志中。
8. **本机 profile 级配置**：换机器或换 profile 需重新放置包与 patch 行。
9. **文件预览有硬上限**：单文件 ≤300 KB，面板一次最多显示 20000 字符（超出提示"已截断显示"）。
10. **白名单以 preset 为准**：隔离 Agent 的工具来自所挂 preset（Windows 上是 `pwsh`，没有 `bash`）。
    勾了 preset 不提供的工具不会报错，但任务详情的「隔离环境实有」会为空，该轮调用会被 guard 打回。
11. **改 Host 半必须重启**：Node 的 ES 模块缓存按 URL 生效，热重载不会重新读盘。
12. **令牌只在页面加载/自取时注入**：桌面版没有刷新入口，令牌失效时面板会先自取、再自动重载一次。
13. **盘符根沙箱会跳过越界写自检**：沙箱根目录设为 `E:\` 这类盘符根时没有更上一级可探，
    自检被跳过（面板显示「未做越界写自检（沙箱根是盘符根）」）；真正的写入仍由文件沙箱在调用时硬拒绝。
    换成子目录（如 `E:\pod-work`）即可恢复自检。

## 开发

### 代码结构

```
lib\index.js     Host 半：Cordis 插件（`apply` / `inject` / `name`）、执行引擎、HTTP 路由、持久化
lib\client.js    Client 半：手写 __ModuleLoader__ bundle，注册 sidebar.panellist 与 main 两个槽位
```

### 改动生效规则

| 改动 | 生效方式 |
|---|---|
| `lib/client.js` | **热生效**：模块图变化经 `/plugins/events` 推给页面，新条目当场挂载（实测无需刷新） |
| `lib/index.js`（Host 半） | **必须重启 DSH**：Node 按 URL 缓存 ES 模块，同路径改文件拿到的仍是旧模块 |
| `package.json` | 重启后生效（浏览器半的解析依据） |
| patch 行（增 / 删 / 改） | **热生效**：`dsh-hmr` 监听 profile patch；未激活只告警，不锁死启动 |

调试 Host 半时若不想反复重启，可把改动写到一个**新文件名**（如 `lib\stage.js`）并把 patch 行的 `name`
临时指过去——这是热重载。**验证完必须改回 `lib\index.js` 并删除该临时文件**；
另外注意把行改回后，当前进程会重新 import 已被缓存的 `index.js`（旧代码），
所以最终状态仍需一次重启来对齐。

> 桌面版提示：release 构建**没有**「刷新页面」菜单（它只在 `development` 下注册）。
> 需要让页面重新走一遍启动注入时，请退出并重新打开应用；只改 `lib\client.js` 则不需要。

### 调试技巧

- `/status` 的 `build` / `pluginVersion` / `compat` 三个字段可确认当前进程实际加载的版本与接口适配结论。
- 面板本身可自证：任务详情显示沙箱模式、`越界写已被拒绝`、主会话上下文条数、
  「可用工具」与「隔离环境实有」两行工具面对账。
- 令牌通道可单独验证：无 cookie 的 `GET /isolation-pod/bootstrap` 应返回 401，
  无令牌的 `POST /isolation-pod/api` 应返回 403。
- 模块图与热重载可观察：`curl.exe -s --max-time 5 http://127.0.0.1:19387/plugins/events` 会先发一帧
  `graph`，此后每次改客户端 bundle 都会推一帧 `rebuilt`。
- 子会话日志在 `<DSH_HOME>\sessions\--<编码后的 cwd>--\<会话ID>\session.v3.jsonl.zstd`，
  是**多帧 zstd**——用 `zstdDecompressSync` 只解得出第一帧（会话头），需要按 magic 逐帧解压。

## 相关文档

- `使用教程.md`：从零上手的分步走查（界面导览、第一个任务、多轮追问、返回与导出、排障、逐条验收）。
- `需求说明.md`：功能需求规格（只描述功能行为，不含实现方案）；与实现的差异见
  [规格与本实现的差异](#规格与本实现的差异)。
- `CHANGELOG.md`：版本变更记录（Keep a Changelog 风格）。

## 许可

MIT，见 [`LICENSE`](LICENSE)（`package.json` 的 `license` 字段同为 MIT）。
