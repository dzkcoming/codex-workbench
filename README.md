# Codex 多终端调试台

当前主线是 **原版 Codex CLI + Tabby 终端引用插件**。首版已安装，桌面入口名为 **Tabby · Codex 引用**，运行 `./start-tabby.sh` 也可打开。支持选区固定快照、复制引用、历史引用页、只读 MCP，以及独立插件扩展示例。

日常引用已简化为 **引用到 Codex**：在右侧终端选中文本，右键 **引用到 Codex** 或按 **Ctrl+Shift+Y**，放入同一顶部调试页接收分屏当前显示的 Codex 草稿，不自动发送。左侧切换 Codex 标签后，后续引用随之切换；多个可见 Codex 分屏时首次选择接收分屏。无法确认目标时复制引用并提示手动粘贴。原 **引用篮** 保留为备用收集入口，Codex 仍在普通终端中自行启动。

已增加 **分屏内独立标签页**：保留窗口顶部标签，在一个标签中分屏，再在每个分屏内分别切换多个终端。入口是工具栏的“分屏内标签”，每个分屏用“＋”添加终端、用“⋯”新建分屏或打开 SSH、串口、Codex。

分屏内也支持 **网页 / 本地 HTML 标签**：点击工具栏地球图标，或 **⋯ → 在此分屏打开网页 / HTML…**。网页与终端共用标签切换、改名和布局恢复；Ctrl+Shift+T 仍新建终端。

详细步骤、验证结果和扩展方法见 [Tabby 引用插件说明](tabby/README.md)。完整需求与阶段记录见 [设计文档](codex-terminal-workbench-design.md)。

下文描述此前实现的 Web 工作台：React + TypeScript + xterm.js 前端，独立 Node.js 终端采集服务，Codex App Server 与 stdio MCP。

## 已有 Web 工作台的使用

```bash
./start.sh          # 经 AI Entry 启动后台，打开浏览器并自动登录
./start.sh --no-open
./stop.sh           # 停止全部后台与终端连接，保留历史记录
```

页面：<http://127.0.0.1:10017/>。AI Entry：<http://127.0.0.1:10000/>，位于「Agent 工作流」。程序默认监听 `0.0.0.0:10017`，可从本机局域网地址访问。

应用菜单已安装「Codex 调试台」。直接从 Portal 或局域网首次访问时，填写项目 `data/access-token` 中的口令；`start.sh` 会自动登录。口令只用于此工作台，浏览器不会得到 Codex 登录凭证。不要将 `data/` 提交到版本库。

1. 选择当前项目，或添加一个已存在的项目目录。
2. 添加本地 Shell、SSH 主机/配置别名、或串口路径与波特率。串口默认 8N1；SSH 使用系统客户端，登录和主机指纹确认在终端中完成。
3. 在终端中直接输入；切到「日志」可搜索历史、勾选记录并引用范围。搜索是区分大小写的字面量搜索，支持跨分包与分页。
4. 在对话中输入 `@build` 或 `@{含空格的终端名}`，会固定最近最多 16 条记录（最多 64 KiB）并附带来源、会话和批次。也可使用「引用最近日志」。模型能通过 MCP 追加检索。
5. 点击回答中的日志引用可跳转原始记录。固定快照保留原始文本，即使对应原始文件被人工移除也能查看。
6. 默认只有人工能输入终端。开启「允许模型输入」后，模型可通过 MCP 发送；关闭后会取消尚未开始的模型输入，已发出的命令不会撤销。
7. 一轮测试前点击「开始新批次」，该项目所有终端后续日志共享新的 `run_id`。

每个项目保存一个当前 Codex 会话；会话菜单提供新建和重启。新建后旧会话仍在 Codex 本地记录与工作台数据库中，第一版没有旧会话选择器。

## 安装与验证

```bash
./setup.sh
source scripts/runtime.sh
export PATH="$PWD/node_modules/.bin:$PATH"
tsc --noEmit
tsc -p tsconfig.server.json --noEmit
tsx --test tests/*.test.ts
node tests/system.mjs
WORKBENCH_CODEX_TEST=1 node tests/system.mjs
```

`setup.sh` 在项目 `.runtime/` 安装固定的 Node.js 22.23.4，`npm ci` 使用锁定依赖，然后构建、注册 Portal 和应用菜单入口，不替换系统 Node。初次安装需要 npm、网络和 Linux 原生依赖构建工具（如果当前平台没有预编译包）。

对应 npm 脚本为 `check`、`build`、`test`、`test:system`、`test:codex`。若默认 npm 版本过旧，使用本机较新的 npm，或直接运行上述本地命令。

系统测试在 `test-results/system-*` 创建独立数据目录、伪串口和仅绑定回环地址的临时 sshd，不连接工位设备，也不修改 SSH 全局配置。依赖 `python3`、`ssh`、`sshd`、`ssh-keygen` 和 `/usr/bin/google-chrome`。真实模型测试会使用现有 Codex 登录和额度，验证实际 MCP 调用、两个来源的准确引用、重启后的连续采集和同一会话恢复。测试截图与报告保存在测试目录。

协议固定为 **Codex CLI 0.163.0**。优先使用 `CODEX_BIN`，否则使用 `~/.local/bin/codex`，最后才查找 `PATH`；发现其他版本会明确拒绝启动对话。`protocol/` 是由本机该版本 `codex app-server generate-ts` 生成的类型。升级时重新生成并运行系统测试，不能仅修改版本字符串。

接口依据：[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。当前实现使用 stdio JSON-RPC，保留 Codex 原有模型循环、内置工具、审批与上下文管理，没有抓取 CLI 屏幕。

## 服务与数据

```text
AI Entry → supervisor
             ├─ terminal-service ─ PTY / ssh / SerialPort
             │       ├─ data/terminal.sqlite
             │       ├─ data/raw/<session>.<part>.bin
             │       └─ data/terminal.sock（仅本用户可访问）
             └─ app ─ HTTP :10017 ─ 浏览器
                    ├─ data/chat.sqlite
                    └─ codex app-server ─ MCP 薄适配进程 ─ terminal.sock
```

终端服务单独持有设备。网页刷新/关闭、停止模型任务、重启 Codex 或重启 Web 后端均不关闭采集。supervisor 自动重启崩溃的服务。采集服务本身崩溃会关闭设备；恢复时将未关闭会话标为可能缺失，用户需手动重连，重连会创建新 `session_id`。

原始字节按 16 MiB 分段，写入并同步后才发布 SQLite 索引。读取按序号游标返回 `next_cursor`、`has_more`、缺口和断开原因。UTF-8 使用流式解码，原始控制字符保留。日志视图不是全屏终端屏幕的语义解析；复杂全屏程序不属于第一版保证范围。

浏览器每次只读取有限数据，等待 xterm 消化后再取下一批；屏幕首次回放最近 128 条，列表最多显示最近 1500 条，完整历史仍可搜索。暂停显示只暂停浏览器读取。输入队列限制为 128 个请求，单次输入最大 64 KiB。持久化故障会停止采集并显示错误，不静默丢弃。

`data/` 包含原始输出、人工与模型输入、引用快照及对话，应按本地私有调试数据管理。当前保留完整历史，不自动删除旧日志；文件分段不代表总磁盘空间有上限。断电、主机休眠、磁盘故障或采集进程崩溃不能保证连续采集。

发送状态为 `queued → writing → sent`，失败可能成为 `unknown`。相同 `operation_id` 与内容只返回原记录，复用 ID 发送不同内容会报错。`sent` 仅表示交给连接，不保证设备执行完成。`terminal_wait` 必须从操作的 `before_cursor` 之后等待，返回 `matched`、`timeout`、`disconnected` 或 `gap`。崩溃时正在写入的操作恢复为 `unknown`，不得盲目重发。

`matched` 只说明新输出中出现了目标文本，命令回显也可能命中。判断执行成功应使用独立结束标记、退出码或设备明确的完成条件。

## MCP 与权限

提供 `terminal_list`、`terminal_sessions`、`terminal_read`、`terminal_search`、`terminal_send`、`terminal_wait`、`operation_status`、`snapshot_create`。每个 MCP 进程绑定项目，无法读写其他项目的终端。stdio 进程退出不关闭设备。

MCP 通过每个 App Server 会话的配置覆盖注入，不修改 `~/.codex/config.toml`。复用已有 Codex 身份、模型与权限配置。内置命令、文件修改、权限申请和用户提问事件显示在对话中；未支持的服务器请求会明确返回错误。

Web 接口使用独立随机口令、HttpOnly / SameSite cookie 和同源检查。HTTP 页面属于本机/可信局域网工具，没有提供互联网部署与多用户隔离。

## 开发与当前边界

- `server/store.ts`：原始日志、SQLite、游标、查询和不可变引用。
- `server/terminal-service.ts`：Shell / SSH / 串口、发送队列和等待。
- `server/mcp.ts`：绑定项目的 MCP 适配。
- `server/codex.ts`：版本校验、JSON-RPC、流式事件、会话恢复和审批。
- `server/app.ts`：浏览器 API、访问控制与静态页面。
- `web/`：三栏工作台、终端分屏、引用、搜索和对话。

第一版没有自动 panic 唤醒模型、无人值守调试、GDB 专用适配、任意外部终端接管、串口流控配置或自动日志清理。支持一个活动 Codex 任务、多个项目、约三个日常受管理终端。

本地独立调试可运行：

```bash
source scripts/runtime.sh
WORKBENCH_DATA=/tmp/workbench-dev node dist/server/supervisor.js \
  --allow-standalone --host 127.0.0.1 --port 18017
```

日常启停应使用 Portal / `start.sh` / `stop.sh`。Web 后端和采集日志位于 AI Entry 的 `run/codex-workbench.log`。
