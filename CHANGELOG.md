# 更新日志

本项目的所有重要变更都记录在此文件。

## 书写约定

- 格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。
- 小节固定为 **新增 / 变更 / 修复 / 移除 / 文档 / 安全 / 说明**（首个版本可另用 **已知限制** 记录当时的结论），
  没有内容的小节直接省略。
- 每个版本先给一段摘要，再分小节；摘要要写清「这一版解决什么问题、影响谁」。
- 版本号三处必须一致：`package.json` 的 `version`、`lib\index.js` 的 `PLUGIN_VERSION`、本文件的标题，
  以及附注标签 `vX.Y.Z`。
- 每条 Host 半改动都应递增 `lib\index.js` 的 `BUILD`，并在摘要里注明累计值（`build: N`）。
- 已发布的版本段落视为历史记录，**只追加更正说明，不改写原文**。

## [未发布]

### 文档

- **文档规范化重写**：统一文档集的结构与术语，并消除版本滞后。
  - `README.md`：新增「文档索引」「书写约定」「术语表」「发布约定」；补齐 `compat` 字段表；
    顶部元信息表与示例响应更新到 `v0.1.3` / `build: 8`；实测结论改为**按插件版本逐条标注**。
  - `使用教程.md`：按操作顺序重排，每一步补「预期结果」；界面文案逐字对齐 `lib/client.js`；
    术语与 README 术语表一致。
  - `README.en.md`：与中文版逐节对应重写。
  - `需求说明.md`：补文档定位说明（需求基线，不随实现修订，差异见 README）。
  - 本文件：改为固定小节格式，补「书写约定」，并把 0.1.2 段落里指向「未发布」的更正指向 0.1.3。

## [0.1.3] - 2026-09-25

修掉 v0.1.2 引入的一处**功能性回归**：隔离 Agent 的工具面被误判为空，pod 一个工具都用不了。
只有 Host 半与文档变更（`build: 8`）。

### 修复

- **工具面被误判为空，导致隔离 Agent 一个工具都用不了（v0.1.2 的回归）**：
  为使「白名单」与「preset 实际提供的工具」一致，v0.1.2 在任务启动时用
  `agentCtx.tools.schemas()` 取工具面并与白名单求交。但 `schemas(scope)` 的 scope 参数是有语义的——
  **省略 scope 得到的是「全局面」**，而桌面版 / Web 面上工具按 preset 分层、全局工具与白名单毫无交集，
  于是交集为空、`task.allow` 被清成 `[]`，pod 只能收到「工具 X 未被授权」的拒绝。

  > 实测证据（一次真实任务的子会话日志，文案为 v0.1.2 当时的措辞）：
  > `可用工具（其它工具已被拒绝）：（无：当前 preset 未提供白名单里的任何工具，请在面板调整白名单或 preset）`，
  > 随后 `pwsh`、`write` 两次调用均被 guard 拒绝。

  修复内容：
  1. 取工具面时传入 **该 pod 的 agent 作为 scope**（`agentCtx.tools.schemas(agent)`）；
  2. **不再与白名单求交** —— 白名单只作上限，由 guard 强制执行，因此不可能被清空；
  3. 真实工具面以该 pod 自己的 `request/header` 为准（首次派发时到达），覆盖启动期的探测结果；
  4. 面板的「可用工具」与「隔离环境实有」两行分别表示「白名单上限」与「该 pod 实际可见的工具」，
     空白时的提示语相应改为「白名单为空，请在「配置」勾选工具」。

- **离线用例**：以桩上下文驱动真实 HTTP 路由，断言 `schemas` 只以 agent 为 scope 调用、
  白名单不再被清空、`request/header` 会覆盖工具面 —— 三项均通过。

### 说明

- **升级后必须重启一次应用**：Host 半有改动（`build: 8`），Node 按 URL 缓存 ES 模块；
  Client 半与 patch 行改动仍是热生效的。
- 配置无需迁移：`allowedTools` 依旧是白名单，只是不再会被 preset 求交清空。
- **产物链路（生成文件 → 导出 / 撤销）在 0.1.7 上仍未复测**：v0.1.2 那次实测因本缺陷没走到产物，
  修复后的完整验证待做。

## [0.1.2] - 2026-09-25

适配 DSH **0.1.7**（桌面版 Desktop 0.1.7-rc.2 与 `dsh web` 共用同一套 profile 与宿主）。
本版修掉三处在 0.1.7 上会让插件**完全不可用**的接口变更、一处**在特定沙箱根拼写下会让每个任务都被中止**
的自检边界问题，并补齐桌面版特有的令牌通道。Host 半改动累计到 `build: 7`。

### 修复

- **`ctx.shell.run` → `ctx.shell.execute`**：0.1.7 的 shell 能力是
  `resolve(request)` + `execute(spec)`，返回进程句柄、由 `handle.result()` 给出 `ShellRunResult`。
  旧代码直接调用并不存在的 `run()`，导致创建任务目录、导出、清理全部失败
  （`startTask` 只会返回 `MKDIR` 错误）。现在按能力探测选择入口，`/status` 的
  `compat.shellApi` 会报告实际用了哪一个。
- **令牌投递改为结构化索引注入行**：桌面版页面由 Electron 的 `serveWebDocument` 直接发出，
  **不会**经过 `webServer.renderIndex()`，因此旧的 `tapIndex` 在桌面版永不执行，
  页面上没有 `window.__DSH_IPP__`，面板所有调用都 403。现在改为
  `webserver/index-inject` 的 `{ kind: 'global' }` 行——Web 版渲染进 HTML，桌面版经 IPC 交给渲染进程。
- **`followup` 消息形状**：`MessageSource` 是闭合联合 `user | model | tool | system-prompt`，
  旧的 `{ kind: 'plugin', … }` 已不是合法来源，改为 `{ kind: 'user' }`。
- **主会话识别**：0.1.7 的会话列表快照不再有 `current` 字段，面板因此一直显示「未定位到主会话」、
  **无法启动任何任务**。改为按内置面板同一算法解析——快照里 `retainedBy.mainView > 0` 的那个会话
  （`replaceMain` 持有该引用，打开面板并不会释放它），并保留旧字段作为兜底。
- **沙箱根目录归一化 / 越界写探针的边界**：探针落在根目录的**上一级**，而 `E:\pod-work\` 这种尾部
  反斜杠会让探针落回沙箱内部（写入合法 → 自检判定「越界写未被拒绝」），于是**每个任务都会被中止**。
  现在配置值在写入与读回时都归一化（去尾部反斜杠、盘符根保留一个分隔符）；根目录若本身就是盘符根
  （如 `E:\`），没有更上一级可探，自检标记为 `skipped-no-parent` 并在面板显示
  「未做越界写自检（沙箱根是盘符根）」，任务**不再被误判中止**。
  自检结论同时以 `sandboxProbe`（`denied` / `skipped-no-parent` / `allowed` / `ambiguous`）随任务记录暴露。

### 新增

- **`GET /isolation-pod/bootstrap`**：对**已被 harness 浏览器认证**的调用者返回令牌。
  桌面版 release 构建没有「刷新页面」入口（重载菜单只在开发构建注册），
  而 Client 半是经模块图推送热挂载的、拿不到随页面加载的注入行——这条路由正是首次安装不刷新即可用的原因。
  无 cookie 时返回 401。
- **Client 半令牌获取链**：`__DSH_IPP__` → `/isolation-pod/bootstrap` → 抓同源 HTML（Web 路径）→
  单次自动重载（`sessionStorage` 5 秒防抖）。全部失败时面板顶部横幅给出「重新载入页面」按钮与
  分平台的处理建议，而不是停在「加载中…」。
- **面板自证信息**：任务详情新增「隔离环境实有」（该 pod 真实可见的工具面）；
  preset 挂载失败等 setup 提示也随任务记录展示与持久化。
- **`/status` 的 `pluginVersion` 与 `compat`**：`{ shellApi, indexInject, bootstrap }`，
  用于一眼确认当前进程加载的版本与接口适配结论。

### 变更

- **白名单与 preset 对齐**（**该实现已于 0.1.3 修正**，见该版本的「修复」）：隔离 Agent 的工具来自
  所挂 preset，因此任务启动后会把配置的白名单与 pod 真实工具面求交，并把结果同时写进系统提示词与
  任务详情；`tools.restrict()` 也只传本部署确实注册过的名字（0.1.7 对未知名字会直接抛错）。
- **`KNOWN_TOOLS` 按 0.1.7 工具面重写**：移除已不存在的 `ralph`、`list_subagent_models`，
  补入 `read_image`、`load_workspace_dependencies`、`cordis_inspect_*`、`plugin_manager` 等；
  `bash` 保留给非 Windows 部署。
- **模型选项透传**：子会话沿用主会话的默认模型选择，含 `reasoningEffort`（此前只透传 provider/model）。
- **面板配置页的 Agent preset 在注册表可用时显示为下拉框**，并标注损坏的 preset。
- Client 半 `package.json` 的 `dsh.client.platform` 仍为 `"web"`——0.1.7 的 `dsh-client-modules`
  明确要求该字面量，桌面版也不例外。

### 文档

- **全套文档重写**（`README.md` / `README.en.md` / `使用教程.md` / `CHANGELOG.md`）：
  统一到 0.1.7 与当时版本的事实，补齐「与宿主的接口约定（0.1.7）」对照表，
  并把「已验证的行为」按实测版本与平台分组，未复测的结论不再被当作已验证。
- 新增「**规格与本实现的差异**」一节，逐条列出 `需求说明.md` 与本实现的有意差异
  （多轮对话、清理范围、撤销范围、并发与 preset 配置、平台限定、白名单口径）。
- 新增「桌面版差异」：桌面版 = 同一个 loopback Web 宿主（固定 19387）+ `dsh-web-app`，
  差异只在页面来源与注入方式；补充「release 版无刷新入口」「改 Host 半需重启」等操作性说明。
- 诊断端点示例改用桌面版端口 19387，并给出 `compat` 三个字段的读法。
- **更正过时告警**：旧 README 称未激活的插件行会让 dsh 拒绝启动。0.1.7 的
  `auditStartupEntries` 只对固定必需集合（`agent-loop`、`webserver`、`modules`、`connection`、
  `headless-runner`、`acp`、`sdk-jsonrpc-server`）拒绝启动，其它未激活项仅告警；
  因此「不要写进 home 级 patch」的理由改为「它会作用于所有 profile、在 CLI/TUI profile 里只留下无意义告警」。
- 「改动生效规则」表补齐 patch 行的热生效，以及 Client 半**无需刷新**的模块图热挂载。
- 教程按当前界面文案逐条校对（面板顶部状态条、任务详情两行工具面、令牌横幅与「重新载入页面」按钮），
  并补上盘符根跳过探针的排障行。

### 说明

- 本版 Host 半与 Client 半都有改动：`lib/index.js` 被 Node 按 URL 缓存，**改完必须重启应用**；
  Client 半与 patch 行改动均为热生效（实测：加行即激活，侧边栏入口自动挂载，无需刷新）。
- 任务链路以「桩上下文 + 真实 HTTP 路由」的离线用例验证：`setConfig` 归一化、
  `startTask → 越界写探针 → 转写 → 结论`、盘符根跳过探针均按预期落位；
  真实任务在桌面版上的复测结论见 README「已验证的行为」。

## [0.1.1] - 2026-09-15

小版本更新：面板可直接预览沙箱里生成的文件内容；仓库补齐 `LICENSE` 与英文文档。
只有 Client 半与文档变更（Host 半未改），`/status` 的 `build` 仍为 5。

### 新增

- **面板文件内容预览**：任务详情的「生成文件」列表中，每个文件行新增 `预览` 按钮，
  就地展开该文件内容（等宽字体、可滚动、显示字节数，截断时提示「已截断显示」）；
  底层复用 Host 半既有的 `readSandboxFile`（单文件 ≤300 KB，一次最多 20000 字符）。

### 文档

- 新增 `LICENSE`（MIT）与 `README.en.md`（英文文档），中英文 README 互相链接。
- README 与使用教程同步补上文件预览的用法与硬上限说明。

### 说明

- `git pull` 后浏览器会自动重载面板，**无需重启 dsh**。

## [0.1.0] - 2026-09-14

首个可用版本：一个常驻的 DSH 插件，在主会话之外运行受沙箱约束的隔离任务，
主会话默认完全无感，结果返回与文件导出都必须手动确认。

### 新增

- **隔离执行引擎（Host 半）**：每个任务创建一个独立子会话
  （`origin: subagent`，cwd = 沙箱根目录），在 setup 窗口写入 `sandbox/mode` 与 `approval/policy`、
  挂载 Agent preset、安装工具 guard 与 `isolation-pod/rules` 系统提示段。
- **越界写预检**：任务开跑前向沙箱外写探针，**必须**被系统拒绝才放行；否则任务立即失败
  （记录 `fsDenied`，面板显示「越界写已被拒绝」）。
- **工具白名单**：`tools.guard()` 为权威拦截（`restrict()` 仅作补充），白名单外的调用直接报错；
  `write` / `edit` 额外做一次路径归属校验。
- **HTTP 接口**：`GET /isolation-pod/status`（本地诊断，无需令牌）与
  `POST /isolation-pod/api`（`x-ipp-token` 门禁，14 个方法）。
- **持久化**：配置、任务与导出记录写入 `<DSH_HOME>/isolation-pod.json`
  （临时文件 + rename 原子替换，变更后 800 ms 防抖）；重启时把仍在运行的任务标记为 `interrupted`。
- **执行记录**：会话事件折叠为转写条目（`user` / `prompt` / `assistant` / `tool` / `turn`，
  并单独保留 `reasoning` 思考块）；内存上限 500 条/任务、落盘镜像 80 条；
  本地副本缺失时经 `sessionQuery.readSession(子会话ID)` 从子会话自己的落盘日志回填。
- **多轮对话**：`followUp` 往同一个常驻子 Agent 续发消息，沙箱、审批策略、工具 guard 与系统提示段
  原样复用；`turns` 逐轮累加，每轮独立超时并可停止。
- **面板（Client 半）**：侧边栏入口 + 四个页签（任务 / 新建 / 配置 / 导出记录）；
  任务详情为对话视图——分角色气泡、工具调用行、轮次分隔线、可折叠的思考过程与首轮指令。
- **结果返回**：`previewReturn` 生成可自由编辑的预览文本，`returnToMain` 注入主会话**一条**精简结果。
- **文件导出**：复制 / 移动两种方式，冲突策略覆盖 / 跳过 / 重命名；每次导出单独确认，
  复制模式可在「导出记录」撤销。
- **令牌自愈**：dsh 重启后已打开的页面持旧令牌时，客户端遇 `403` 会重新抓取同源 `/` 解析新令牌重试，
  因此无需刷新页面；确实失败时面板显示错误横幅而非停在「加载中…」。
- **沙箱告警**：仅当沙箱根目录落在**当前会话**的工作区内时才提示会产生可见产物。

### 安全

- 主会话默认零痕迹：隔离任务不向主会话写入任何事件，唯一入口是用户手动的 `returnToMain`。
- 沙箱外写入由 DSH 文件沙箱**硬拒绝**；清理操作不触碰主会话与沙箱之外的任何文件。
- 导出目标必须位于沙箱之外，且每次导出都需要重新确认，不存在自动延续的授权。

### 已知限制

> 以下为该版本当时的结论，其中 profile 一条已在 0.1.2 更正。

- **平台**：Windows 专有实现（目录创建/删除/导出走 PowerShell），macOS / Linux 未验证。
- **profile**：需要带 Web UI 的 profile，且不可写入 home 级 patch。
  （**0.1.2 更正**：未激活的插件行只会告警、不会拒绝启动；真正的理由是 home 级 patch 会作用于所有
  profile，在 CLI/TUI profile 里只留下无意义告警。）
- **shell 沙箱**在 Windows 上是 `partial`（ACL 受限令牌）；只有文件系统沙箱是硬拒绝。
- **多轮对话不跨进程**：dsh 重启后旧任务只能查看与导出。
- 面板当前只列文件清单，**不做文件内容预览**（0.1.1 已提供）。

[未发布]: https://github.com/Teow9/dsh-isolation-pod/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Teow9/dsh-isolation-pod/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Teow9/dsh-isolation-pod/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Teow9/dsh-isolation-pod/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Teow9/dsh-isolation-pod/releases/tag/v0.1.0
