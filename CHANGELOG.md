# 更新日志

本项目的所有重要变更都记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.1.1] - 2026-09-15

### 新增

- **面板文件内容预览**：任务详情的「生成文件」列表中，每个文件行新增 `预览` 按钮，
  就地展开该文件内容（等宽字体、可滚动、显示字节数，截断时提示「已截断显示」）；
  底层复用 Host 半既有的 `readSandboxFile`（单文件 ≤300 KB，一次最多 20000 字符）。

### 文档

- 新增 `LICENSE`（MIT）与 `README.en.md`（英文文档），中英文 README 互相链接。
- README 与使用教程同步补上文件预览的用法与硬上限说明。

### 说明

- 本版**只有 Client 半与文档变更**（Host 半未改）：`git pull` 后浏览器会自动重载面板，
  **无需重启 dsh**，`/status` 的 `build` 仍为 5。

## [0.1.0] - 2026-09-14

首个可用版本：一个常驻的 DSH 插件，在主会话之外运行受沙箱约束的隔离任务，
主会话默认完全无感，结果返回与文件导出都必须手动确认。

### 新增

- **隔离执行引擎（Host 半）**：每个任务创建一个独立子会话
  （`origin: subagent`，cwd = 沙箱根目录），在 setup 窗口写入 `sandbox/mode` 与 `approval/policy`、
  挂载 agent preset、安装工具 guard 与 `isolation-pod/rules` 系统提示段。
- **越界写预检**：任务开跑前向沙箱外写探针，**必须**被系统拒绝才放行；否则任务立即失败
  （记录 `fsDenied`，面板显示「越界写已被拒绝」）。
- **工具白名单**：`tools.guard()` 为权威拦截（`restrict()` 仅作补充），白名单外的调用直接报错；
  `write`/`edit` 额外做一次路径归属校验。
- **HTTP 接口**：`GET /isolation-pod/status`（本地诊断，无需令牌）与
  `POST /isolation-pod/api`（`x-ipp-token` 门禁，14 个方法）。
- **持久化**：配置、任务与导出记录写入 `<DSH_HOME>/isolation-pod.json`
  （临时文件 + rename 原子替换，变更后 800 ms 防抖）；重启时把仍在运行的任务标记为 `interrupted`。
- **执行记录**：会话事件折叠为转写条目（`user` / `prompt` / `assistant` / `tool` / `turn`，
  并单独保留 `reasoning` 思考块）；内存上限 500 条/任务、落盘镜像 80 条；
  本地副本缺失时经 `sessionQuery.readSession(子会话ID)` 从子会话自己的落盘日志回填。
- **多轮对话**：`followUp` 往同一个常驻子 Agent 续发消息，沙箱、审批策略、工具 guard 与系统提示词
  原样复用；`turns` 逐轮累加，每轮独立超时并可停止。
- **面板（Client 半）**：侧边栏入口 + 四个页签（任务 / 新建 / 配置 / 导出记录）；
  任务详情为对话视图 —— 分角色气泡、工具调用行、轮次分隔线、可折叠的思考过程与首轮指令。
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

- **平台**：Windows 专有实现（目录创建/删除/导出走 PowerShell），macOS / Linux 未验证。
- **profile**：需要带 Web UI 的 profile（`inject` 了 `webServer`），且不可写入 home 级 patch。
- **shell 沙箱**在 Windows 上是 `partial`（ACL 受限令牌）；只有文件系统沙箱是硬拒绝。
- **多轮对话不跨进程**：dsh 重启后旧任务只能查看与导出。
- 面板当前只列文件清单，**不做文件内容预览**（可经 `readSandboxFile` 接口读取，≤300 KB）。

[未发布]: https://github.com/Teow9/dsh-isolation-pod/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Teow9/dsh-isolation-pod/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Teow9/dsh-isolation-pod/releases/tag/v0.1.0
