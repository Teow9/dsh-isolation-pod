# 隔离舱 Isolation Pod

> 在 DSH 主会话之外运行受沙箱约束的隔离任务。主会话默认**完全无感**：不写入消息、不进入模型上下文、
> 界面消息流里没有任何痕迹；结果返回与文件导出都必须由用户**手动确认**。

**English** — A resident DSH plugin that runs sandboxed tasks outside the main session. The main session stays
unaware by default; returning a result or exporting files is manual-only and singly authorized.

| | |
|---|---|
| 形态 | 本地包 + profile patch 行（**不是**动态 Cordis 插件，重启后常驻、无需审批） |
| 依赖 | 零 npm 依赖；Host 半只使用 `node:*` 内建模块 |
| 平台 | Windows（当前实现调用 PowerShell）；需要带 Web UI 的 dsh profile |
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
- [已验证的行为](#已验证的行为)
- [已知限制](#已知限制)
- [开发](#开发)
- [相关文档](#相关文档)
- [许可](#许可)

## 特性

- **主会话零痕迹**：隔离任务在独立会话中运行，全程不向主会话写入任何内容；只有你手动点「返回主会话」，
  才会注入**一条**可编辑的精简结果。
- **沙箱是系统级强制**：沙箱根目录内可读写，根目录外**只能读**；越界写入由 DSH 文件沙箱**硬拒绝**，
  不靠提示词自觉。任务启动前还有一次越界写自检，未被拒绝就中止任务。
- **工具白名单强制生效**：白名单以外的工具调用被 guard 直接打回。
- **结果返回与文件导出互相独立**：两者不自动触发；导出默认单次授权，每次都要重新确认。
- **常驻且免审批**：作为 patch 行随 dsh 启动加载，重启后自动恢复配置与任务记录，不出现审批卡片。
- **多轮对话**：任务详情即对话视图，可就同一会话继续追问（见[多轮对话](#多轮对话)）。
- **执行记录可查、可清**：对话转写、工具调用、思考过程、生成文件清单都在面板内；清理不影响主会话与沙箱外文件。

## 工作原理

### 形态：本地包 + profile patch 行

```
<仓库根目录>\                                   ← 仓库根就是插件包
  package.json                                    name = dsh-isolation-pod（同时是浏览器模块 id）
  lib\index.js                                    Host 半：执行引擎 + HTTP API + 持久化
  lib\client.js                                   Client 半：手写 __ModuleLoader__ bundle（侧边栏面板）
  README.md
  需求说明.md                                     功能需求规格（不含实现方案）

<DSH_HOME>\profiles\<profile>\cordis.patch.yml    ← 唯一的外部改动（一行 insert）
<DSH_HOME>\isolation-pod.json                     ← 配置、任务与导出记录（运行期生成）
<DSH_HOME>\sessions\...                           ← 隔离子会话自己的会话日志（DSH 负责落盘）
```

dsh 把 patch 行里的**绝对路径**改写为 `file://` URL 挂载 Host 半；`dsh-client-modules` 再从同一文件
向上找到 `package.json`，读 `dsh.client`，按 `exports["./client"]` 解析出浏览器半。
**整个链路不需要打包器，也不需要 npm 发布。**

### 一次任务的执行路径

1. 面板把「任务描述」经 `POST /isolation-pod/api` 交给 Host 半；
2. Host 半创建沙箱目录，并创建一个**独立子会话**（`origin: 'subagent'`，cwd = 沙箱根目录）；
3. 在该子的 setup 窗口内写入 `sandbox/mode`、`approval/policy`，挂载 agent preset，装上工具 guard 与系统提示词；
4. 先跑一次**越界写自检**，确认沙箱外写入确实被拒绝，否则中止；
5. 把任务提示（含沙箱规则、白名单、只读的主会话上下文片段）作为一条用户消息送入子会话；
6. 子会话的每个事件被折叠成转写条目（用户 / 助手 / 工具 / 轮次 / 思考），面板增量拉取展示；
7. 结束后停在「已完成」，等待你决定：继续对话、返回主会话、导出文件，或清理。

## 环境要求

- **DSH**：0.1.x，且 profile 里带 Web UI（本插件 `inject` 了 `webServer`）。
- **操作系统**：Windows。当前实现的目录创建/删除/导出走 PowerShell 命令，未在 macOS / Linux 上验证。
- **Node**：随 DSH 提供，无需额外安装；插件本身零依赖，不需要 `npm install`。

## 安装

### 1. 取得包

```powershell
git clone <本仓库地址> dsh-isolation-pod
```

不需要 `npm install`（无依赖），也不需要构建。

### 2. 挂载 patch 行

编辑 `<DSH_HOME>\profiles\<profile>\cordis.patch.yml`（`<DSH_HOME>` 默认是 `%USERPROFILE%\.dsh`；
该文件通常只有注释与 `[]`，直接改成下面这样）：

```yaml
- insert:
    - id: dsh-isolation-pod
      name: '<仓库绝对路径>\lib\index.js'
```

保存即生效（`dsh.profile.patchReload: "live"`）。配置了 `dsh web` 的话，重启一次更稳妥。

> ⚠️ **`name` 必须是绝对路径**，并指向 `lib\index.js`（Host 半）。
> 不要加 `?v=2` 之类的查询串——`fileURLToPath` 不接受带 search 的 URL。

> ⚠️ **本插件只适用于带 Web UI 的 profile。** 行里 `inject` 了 `webServer`，在 CLI/TUI profile 中该行
> 永不激活，而 dsh 启动时会 `assertEntriesActivated`，结果是 **dsh 拒绝启动**。因此：
> - 只写进具体的 Web profile，**不要**写进 `<DSH_HOME>\cordis.patch.yml`（那会作用于所有 profile）；
> - 一旦启动失败，按下面的回滚步骤把该行去掉即可。

### 3. 验证

启动 dsh 后访问本地诊断端点（**无需令牌**）：

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

侧边栏出现「隔离舱」入口即安装成功。

### 卸载 / 回滚

把 `cordis.patch.yml` 还原成 `[]`，或删除该文件（文件缺失 = 该 layer 不存在），然后重启 dsh。

> 建议安装前先复制一份 `cordis.patch.yml.bak`：**这一行是启动关键路径。**

## 使用

### 入口

侧边栏「新会话」下方的一行：盾牌图标 + 「隔离舱」。侧边栏收起成窄栏时只显示图标。点击后中栏切换为
隔离舱全宽面板，页签为 **任务 / 新建 / 配置 / 导出记录**。

> 侧边栏底部（设置旁）**刻意不放**入口：那一行与内置的 Cordis Plugin 按钮共用，放带文字或固定宽度的
> 按钮会被挤没——本项目早期正是这样出现过「右下角显示不出来」。

### 首次使用：指定沙箱根目录

到「配置」页填入**绝对路径**（例如 `E:\pod-work`）。未配置时隔离舱会拒绝执行任何任务，
并且**不会**自动退回使用工作区或项目目录。

### 任务生命周期

新建（填描述，可选子目录）→ 启动 → 在详情页看**对话**与**生成文件** → 继续对话 / 返回主会话 /
导出到工作区 → 清理。主会话在此期间不会收到任何自动消息。

### 多轮对话

任务详情页底部是输入框：**回车发送，Shift+回车换行**，运行中可「停止」。

- 续聊走 `followUp`，往**同一个子会话**再发一条用户消息；沙箱模式、审批策略、工具 guard、系统提示词
  都挂在常驻子 Agent 上原样复用，**不存在"续聊时隔离失效"的路径**。
- 转写稿按角色渲染：`我` / `隔离舱` 气泡、`▶ ◀` 工具行、轮次分隔线；助手条目里可展开
  **思考过程**（模型的 `reasoning` 块），首轮那条机器指令折叠为「本轮发给隔离舱的指令」。
- **连续性仅在进程内有效**：子 Agent 常驻内存，dsh 重启后 `canFollowUp` 变为 false，
  输入框会注明「该会话已随进程结束」；历史仍可查看与导出。（当前明确不做重启后重挂。）

> `需求说明.md` 只描述一次性「执行任务」，没有多轮语义——**多轮对话是本实现相对需求的增量**，
> 其余行为均按规格实现。

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
| `allowedTools` | `pwsh, read, write, edit, glob, grep` | 工具白名单，由 guard 强制执行 |
| `timeoutMs` | `600000` | **每轮**对话的超时（毫秒），超时取消该轮并标记 `timeout` |
| `readContext` | `true` | 是否把主会话最近若干条消息作为**只读**背景注入任务提示 |
| `maxConcurrent` | `3` | 同时运行的任务数上限 |
| `enableExport` | `true` | 关闭后 `exportEntries` 直接拒绝 |
| `allowRememberChoice` | `false` | 是否允许导出时勾选「记住本次选择」（仅预填路径） |
| `presetId` | `'standard'` | 在子会话里挂载的 agent preset id；空串表示不挂载 |

## HTTP 接口

Host 半在 Web 服务上注册了前缀路由 `/isolation-pod`。

| 路由 | 认证 | 说明 |
|---|---|---|
| `GET /isolation-pod/status` | 无 | 本地诊断：`build`、`tokenPrefix`、`taskCount`、`storePath`、`sandbox.liveSessions`、`diagnostics` |
| `POST /isolation-pod/api` | `x-ipp-token` 头 | JSON 单入口：`{ "method": "...", "args": { ... } }` |

令牌是**每次进程启动随机生成**的 UUID，由 Host 半注入到 `index.html`（`window.__DSH_IPP__`），
面板从那里读取。令牌不写磁盘；校验失败返回 `403`。

`method` 一览：

| 方法 | 作用 |
|---|---|
| `getState` / `setConfig` | 读取面板状态（含 `{ mainSessionId }`，用于判定沙箱是否落在**当前会话**工作区内）/ 写入配置 |
| `startTask` / `getTask` / `cancelTask` / `followUp` | 新建任务（取回 `taskId`）/ 增量拉取任务与转写（`fromLogIndex`）/ 取消当前轮 / 继续对话 |
| `listFiles` / `readSandboxFile` | 沙箱文件清单 / 读取文本（≤300 KB，默认截断到 4000 字符） |
| `previewReturn` / `returnToMain` | 生成返回预览文本 / 注入主会话 |
| `exportEntries` / `listExports` / `undoExport` | 导出到工作区 / 导出记录 / 撤销复制模式的导出 |
| `cleanup` | `scope`: `record` \| `files` \| `all` |

## 数据与文件布局

- **状态文件**：`<DSH_HOME>\isolation-pod.json`（`DSH_HOME` 未设置时用 `~/.dsh`）。
  `version: 1`，写入采用「临时文件 + rename」原子替换，变更后 800 ms 防抖落盘。
- **沙箱目录**：`<sandboxRoot>\<任务ID>\`，或在新建时指定了子目录时用 `<sandboxRoot>\<子目录>\`。
- **容量上限**：任务记录 200 条、导出记录 200 条、每任务内存执行日志 500 条；
  落盘镜像保留最近 80 条（单条文本截断 400 字）。
- **重启处理**：启动时仍在 `running` / `queued` 的任务被标记为 `interrupted`（其 Agent 已随进程消失）。
- **执行记录回填**：若某任务的本地日志副本缺失，`getTask` 会用 `sessionQuery.readSession(子会话ID)`
  从子会话自己的落盘日志读回并重新汇总。

## 隔离与权限模型

| 层 | 手段 | 效果 |
|---|---|---|
| 文件系统 | 子会话 `sandbox/mode = workspace-write`，cwd = 沙箱根目录 | 根目录内可写，**根目录外硬拒绝**（`FS_SANDBOX_DENIED`） |
| 审批 | 子会话 `approval/policy = never` | 隔离环境内的操作不需要、也不会弹出审批 |
| 工具 | `tools.guard()`（权威）+ `tools.restrict()`（尽力而为） | 白名单外的工具调用被打回；`write`/`edit` 再叠加一次路径归属校验 |
| 预检 | 任务启动前的越界写探针 | 沙箱外写入**没有被拒绝**就中止任务，绝不带着失效的沙箱开跑 |
| 提示词 | 注入 `isolation-pod/rules` 系统提示段 | 让模型知道可写范围、可用工具与输出目录 |
| 主会话边界 | 独立子会话（无父 Agent） | 不向主会话写入任何事件；唯一入口是用户手动的 `returnToMain` |

## 已验证的行为

- 沙箱外写入被**系统强制拒绝**：运行时自检记录 `fsDenied: true` 后才放行任务。
- 工具白名单由 **guard** 强制执行（`restrict` 无法移除 scoped 注册，因此仅作补充）。
- **主会话零痕迹**：实测生成 CSV、跨 3 轮对话等任务全程，主会话工作区无任何新增文件、无自动消息。
- **配置、任务与导出记录跨重启存活**；仍在运行的任务被正确标记为 `interrupted`。
- **执行记录不因重启丢失**：日志随状态落盘；必要时从子会话日志回填
  （实测：31 条子会话记录 → 14 条转写条目，与独立解压预测一致）。
- **进程内多轮对话**：`followUp` 复用同一常驻子 Agent，`turns` 逐轮累加（实测 3 轮、25 条转写）。
- **令牌自愈**：dsh 重启后已打开的页面持旧令牌，客户端遇 `403` 会重新抓取同源 `/` 解析新令牌重试一次，
  因此**重启后不必刷新页面**；确实失败时面板顶部显示错误横幅，而不是停在「加载中…」。
- **告警判定只针对当前会话**：只有当沙箱根目录落在**你正在看的这个会话**的工作区内时，面板才提示
  「隔离任务生成的文件会出现在你看到的工作区里」；`/status` 的 `sandbox.liveSessions` 可外部核验该判定。

## 已知限制

1. **平台**：Windows 专有实现（PowerShell 命令）；macOS / Linux 未验证。
2. **profile 限定**：需要带 Web UI 的 profile；不能放进 home 级 patch，否则会波及其它 profile。
3. **shell 沙箱是 `partial`**：Windows 上用 ACL 受限令牌实现，属尽力而为；**文件系统沙箱才是硬拒绝**。
4. **平台临时目录**在 `workspace-write` 下仍可写，靠系统提示词收敛。
5. **隔离会话不能当普通会话打开**（`origin: 'subagent'`），一切查看都在隔离舱面板内。
6. **多轮对话不跨进程**：重启后旧任务只能查看 / 导出。
7. **日志上限**：内存 500 条 / 任务，落盘 80 条 / 任务，超出部分只存在于子会话日志中。
8. **本机 profile 级配置**：换机器或换 profile 需重新放置包与 patch 行。

## 开发

### 目录

```
lib\index.js     Host 半：Cordis 插件（`apply` / `inject` / `name`）、执行引擎、HTTP 路由、持久化
lib\client.js    Client 半：手写 __ModuleLoader__ bundle，注册 sidebar.panellist 与 main 两个槽位
```

### 改动生效规则

| 改动 | 生效方式 |
|---|---|
| `lib/client.js` | **热生效**：浏览器 bundle 每次从磁盘重读，`dsh-client-hmr` 会推送重载 |
| `lib/index.js`（Host 半） | **必须重启 dsh**：Node 按 URL 缓存 ES 模块，同路径改文件拿到的仍是旧模块 |
| `package.json` | 重启后生效（浏览器半的解析依据） |

调试 Host 半时若不想反复重启，可把改动写到一个**新文件名**（如 `lib\stage.js`）并把 patch 行的 `name`
临时指过去——这是热重载。**验证完必须改回 `lib\index.js` 并删除该临时文件**；
另外注意把行改回后，当前进程会重新 import 已被缓存的 `index.js`（旧代码），
所以最终状态仍需一次重启来对齐。

### 调试技巧

- `GET /isolation-pod/status` 的 `build` 字段在每次 Host 半改动时递增，可确认当前进程实际加载的版本。
- 面板本身可自证：任务详情显示沙箱模式、`越界写已被拒绝`、主会话上下文条数、可用工具。
- 子会话日志在 `<DSH_HOME>\sessions\--<编码后的 cwd>--\<会话ID>\session.v3.jsonl.zstd`，
  是**多帧 zstd**——用 `zstdDecompressSync` 只解得出第一帧（会话头），需要按 magic 逐帧解压。

## 相关文档

- `使用教程.md`：从零上手的分步走查（界面导览、第一个任务、多轮追问、返回与导出、排障、逐条验收）。
- `需求说明.md`：功能需求规格（只描述功能行为，不含实现方案），本文档的「特性 / 使用 / 隔离与权限模型」
  各节与其 §4、§5 对应；**多轮对话**为相对规格的增量，已在文中标注。

## 许可

MIT（见 `package.json` 的 `license` 字段；发布前请在仓库内补一份 `LICENSE` 文件）。
