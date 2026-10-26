# 验收记录

日期：2026-10-24。协议：Codex CLI 0.163.0。运行时：项目内 Node.js 22.23.4。

## 已通过

- TypeScript 前后端检查与 Vite 生产构建。
- 核心测试：UTF-8 分包、ANSI/无换行字节流一致性、原始日志轮转、游标分页、跨分包搜索、不可变快照、缺失原始文件的显式报告、测试批次、重连会话、崩溃后未知操作、重复操作 ID、模型写入权限、等待超时和断连、磁盘故障。
- 使用 Node SerialPort 连接 Linux 伪终端，连续采集、收发、独占检查与断连。
- 使用系统 `ssh` 客户端连接独立、仅监听回环地址的临时 `sshd`，发送命令并等待新输出。没有连接外部构建服务器。
- 使用真实 MCP SDK 客户端完成 stdio 握手、工具发现、日志读取和跨项目访问拒绝。
- Chrome 自动化：登录、双终端分屏、键盘实际输入 SSH、日志搜索、引用快照、网页刷新后采集连续、390px 手机宽度没有横向溢出；未出现页面脚本异常。
- 真实 Codex App Server 调用 MCP：`terminal_list`、`terminal_read`、`terminal_read`，分别准确读取 SSH 和模拟串口并输出可跳转引用。
- 重启 Codex 期间串口日志继续记录，采集 PID 不变；恢复同一 Codex thread 后能回答上一轮信息。
- 对 Web 后端发送 SIGKILL 后，supervisor 自动恢复 Web；采集 PID、串口 session_id 和日志保持连续。

真实 Codex 测试过程中出现过上游 `workspace routing discovery timed out` / `request timed out`；Codex 自身重试后完成任务。界面会保留这类连接事件，采集服务不受影响。

## 真实模型证据

系统验收目录：`test-results/system-qcJXya/`。

最终核心与浏览器回归：`test-results/system-v0kRpC/`，包含键盘实际输入、引用分页及人工接管后的最终版本验证。

- `report.json`：系统验收结果。
- `codex-answer.txt`：真实模型回答。
- `desktop.png`、`mobile.png`：浏览器截图。
- `terminal.sqlite`、`raw/`、`chat.sqlite`：隔离验收数据与事件。

模型给出的结果为 `BUILD_EVIDENCE=success-4826` 和 `UART_EVIDENCE=voltage-low-7931`，引用分别指向其真实终端 ID、会话 ID 与日志序号。

## 待用户指定目标后验证

尚未连接真实开发板串口和用户的 SSH 构建服务器；需要设备路径、波特率与 SSH 目标。没有执行烧写、复位、修改工位配置等实机操作。长时间运行、主机休眠和真实设备拔插仍需工位验证。

该版本是文档所述 Linux 单用户第一版。后续范围及未实现功能已列在 README，不将模拟串口验收视为真实开发板验收。

## Tabby 引用插件首版验收（2026-10-24）

- TypeScript 检查和四项核心测试通过，涵盖 Unicode、不可变快照、分页、项目隔离及真实只读 MCP。
- 官方 Tabby 1.0.238 中验证了本地 PTY、原生串口驱动连接伪终端、右键菜单回调、选区、剪贴板和历史引用设置页。
- 未安装插件、安装插件、另一路输出与后台写入并行三种场景各采样 30 次。键盘到回显数据中位数分别约 1.6 / 1.7 / 1.5 ms；不包含绘制时间，不作为跨机器性能承诺。
- 原版 Codex CLI 0.163.0 实际调用两次 `reference_read`，识别两路证据；同一会话恢复通过，全局配置文件和登录方式保持一致。
- 第二个独立 Tabby 扩展插件及打开原版 Codex TUI 的入口验证通过。
- 安装器已安装项目内 Tabby 文件、插件链接、应用菜单及中文桌面入口；`~/.local/bin/tabby --version` 返回 1.0.238。

完整使用步骤、实测数据和证据链接见 [Tabby README](tabby/README.md)。本轮只交付固定选区引用；后台持续串口采集与 Tabby 会话的适配仍待后续。

## 分屏内独立标签验收（2026-10-26）

TypeScript 检查、插件构建和四项引用核心测试通过。官方 Tabby 1.0.238 中的十项布局集成检查全部通过，证据位于 `test-results/tabby-panes-oK3esk/`：

- 已运行终端转入内部标签后，session 和 frontend 对象不变。
- 分屏内标签独立切换，后台输出持续，键盘输入只进入目标终端。
- 已移动终端的鼠标焦点、内部标签新增、顶部标签独立切换均正常。
- 左右分屏后继续上下分屏，原生几何布局及大小调整正确。
- 终端引用取得当前分屏内选中标签的文本和来源。
- 原生恢复机制保存并恢复全部内部标签及选中项，后台标签也完成连接初始化。
- 关闭检查可拒绝关闭，关闭后台标签或最后一个标签只结束相应会话/分屏。
- 原生串口连接伪终端，在后台收取数据、切回发送并创建正确来源的引用。
- 原版 Codex CLI 正常显示；切出切回保留会话和未发送的输入草稿；分屏缩放和焦点导航正常。
- 没有 renderer 脚本异常。

布局测试的 20 个回显样本中位数为 5.5 ms、p95 为 8.4 ms；只测量键盘事件到会话回显数据，不包含绘制。原引用插件系统回归位于 `test-results/tabby-system-SvZ5oC/`，设置页、快照记录、真实选区、串口、后台记录并行和退出后的引用读取均通过。

本轮未向模型提交测试草稿，未连接真实开发板或外部 SSH 主机；应用退出后的进程存续和 Codex 对话恢复依旧遵循原生行为。日常 Tabby 窗口保留运行，安装链接已指向构建完成的新版插件，下次启动时加载。

### 新建快捷键和双击改名

新增真实键盘/鼠标测试 `tests/tabby-pane-actions.mjs`，七项检查全部通过，报告位于 `test-results/tabby-pane-actions-U8A4uB/report.json`：普通终端按 Ctrl+Shift+T 只新建一个顶部标签；原生分屏自动启用内部标签并在当前分屏新增；切换焦点后连续快捷键只影响目标分屏；双击内部标签可保存中文名称；Esc 取消改名且恢复令牌保留已保存名称；编辑名称时不触发新建；沿用用户修改后的原生新建快捷键。

为保证连续快捷键目标稳定，补充了原生终端异步启动后的焦点处理。修改后的十项分屏功能回归再次通过，见 `test-results/tabby-panes-ZEtOnI/report.json`，包括真实键盘输入、鼠标焦点、后台串口、原版 Codex 草稿、缩放和恢复。TypeScript 检查和构建通过。本轮仅作功能验收；回显采样存在较大波动（中位数 2.9 ms、p95 221 ms），不据此宣称性能等价。

按用户偏好取消了原生 `rearrange-panes` 的 Ctrl+Shift 绑定，精确修改日常配置并同步新安装初始配置。八项操作回归通过，见 `test-results/tabby-pane-actions-F45e9d/report.json`：新增按住 Ctrl+Shift 时名称浮层不出现的检查，并在保持两个修饰键按下时继续按 T，验证仍只在当前分屏创建一个标签。既有窗口未重启。

### 正文右键分屏与 Alt 导航

`tests/tabby-pane-navigation.mjs` 的五项检查通过，报告位于 `test-results/tabby-pane-navigation-I8mOdJ/report.json`：普通终端 Alt+数字切换顶部标签；正文右键直接生成向右/向下分屏入口并作用于右键所在终端；Alt+1/2/3/4 仅切换当前分屏内标签且越界不操作；Alt+上下左右按实际布局切换焦点、保留各分屏选择且不进入终端输入流；名称编辑框中不切换后台终端。已查看同目录截图，检查标签栏、三分屏布局和遮挡情况。

键盘和双击操作通过 Playwright 在真实 Tabby 窗口执行。右键分屏测试读取实际终端生成的菜单并调用菜单项回调，未自动点击操作系统原生菜单。功能判定使用运行时状态、真实 DOM 焦点、标签数量、几何布局及终端输入事件，不以截图外观单独判定通过。

TypeScript 检查和构建通过；原有八项快捷键/改名操作回归再次通过，见 `test-results/tabby-pane-actions-O8tMx8/report.json`。当前日常窗口保持运行，新插件下次启动时加载。

### 新终端继承当前工作目录

`tests/tabby-pane-cwd.mjs` 的六项检查通过，见 `test-results/tabby-pane-cwd-nByies/report.json`。测试在真实 Shell 中输入 `cd`，再通过 Ctrl+Shift+T 新建终端，同时检查原生会话目录和新终端执行 `pwd -P` 的结果。覆盖普通顶部标签、含中文/空格/单引号的路径、新分屏继承目录、左右分屏分别处于不同目录、明确配置的目录保持不变、异步读取目录期间切换分屏不串来源，以及读取失败时回退到启动目录（失败和延迟使用方法替换模拟）。

TypeScript 检查与插件构建通过；八项快捷键/改名回归通过，见 `test-results/tabby-pane-actions-HpmGtk/report.json`。日常运行窗口未重启。

### 分屏中的网页 / 本地 HTML

基于 MIT `tabby-browser` 0.2.0 适配，许可证保存在 `tabby/licenses`，并复制到构建产物 `dist/licenses`。已通过 TypeScript 检查和构建，6 项单元/引用领域测试通过。

真实 Tabby 网页测试 `tests/tabby-browser.mjs` 的 14 项检查通过，报告位于 `test-results/tabby-browser-oqXzZh/report.json`：

- 从实际工具栏 provider 入口打开空网页标签，再使用地址栏加载本机 HTTP 页面；原终端 session/frontend 对象保持不变，网页中 `require` 和 `process` 都不可用。
- 网页中 Alt+数字切换分屏内标签，网页草稿保留；Alt+方向键切换实际焦点，快捷键不进入终端输入流。
- 网页中 Ctrl+Shift+T 仍在当前分屏新建 Shell，并继承最近终端目录。
- 地址栏、Ctrl+L、后退/前进、F5、真实鼠标链接跳转，以及 target=_blank 在原分屏创建网页标签。
- 含中文、空格、引号的本地 HTML 路径、双击改名和弹窗期间网页隐藏/恢复。
- 窗口缩放、鼠标拖动分隔线和加载错误后的重新导航。
- 通过 Tabby 完整恢复令牌重建混合分屏，保留 URL、名称和选中项；切换顶部标签隐藏旧网页并停止它的布局轮询。
- 关闭网页销毁 WebContents，原终端继续运行；单独关闭测试宿主窗口也清理其网页 WebContents，并检查退出日志没有网页主进程桥的未捕获异常。

网页键盘和链接点击通过 Electron `WebContents.sendInputEvent` 发送，覆盖主进程 `before-input-event` 拦截；宿主地址栏、改名和分隔线通过 Playwright 操作。图像验收使用 ImageMagick `import -window` 抓取测试窗口的实际合成图像（`browser-workspace.png` / `native-before-click.png`），因为 `BrowserWindow.capturePage` 与 Playwright 主页面截图都不能包含原生网页子视图。文件选择器仍使用宿主原生对话框，本轮通过地址栏和加载接口验证文件路径，未自动点击操作系统文件选择窗口。

修复了两个实际集成问题：当前 Linux Tabby 自带 `--no-sandbox`，强制创建 sandbox 子视图会白屏，因此网页遵循宿主模式，同时保持 Node 集成关闭、contextIsolation 开启；网页/终端切换后 Tabby 的首次快捷键部分匹配可能漏掉拦截，已对工作台的分屏快捷键保留完整匹配，防止导航字符进入 Shell。没有修改宿主启动参数、终端收发链路或 Codex 配置。

原有回归全部通过：方向导航 5 项（`test-results/tabby-pane-navigation-ecPrwf`）、工作目录 6 项（`test-results/tabby-pane-cwd-4aZqV4`）、新建/改名 8 项（`test-results/tabby-pane-actions-KOIc6e`）、完整分屏 10 项（`test-results/tabby-panes-YCAftT`）。后者包含后台伪串口收发、选区引用、原版 Codex CLI 的同会话与未发送草稿保留。本轮未向模型提交问题，未验证外部网站登录或真实设备。测试使用独立配置和进程组；日常窗口未重启，新插件在下次启动时加载。

### 移除顶部 Codex 启动入口

移除了 `ReferenceToolbar` 及其 provider 注册，使用说明改为用户在普通终端自行运行 Codex。TypeScript 检查和构建通过；独立 Tabby 实例读取实际工具栏 provider，确认 Codex 启动按钮已消失，网页及分屏按钮保留。报告：`test-results/tabby-toolbar-T218ni/report.json`。日常窗口未重启，菜单变更下次启动加载。该阶段提出的引用篮在下一节完成验收。

### 跨终端引用篮（2026-10-26）

TypeScript 检查、构建与 10 项领域/MCP 测试通过。领域测试新增跨来源备注与排序、重新打开后的恢复、并发写入、旧版本编辑保护、长内容文件引用、内容篡改拒绝、项目隔离，以及移除/清空后保留快照。后台退出后的锁恢复使用每次独有的所有者标识，避免两个恢复者误删新取得的锁；测试在放置已退出进程的锁后并发添加 10 条，验证没有丢失。

真实 Tabby 的 8 项引用篮检查通过，见 [报告](test-results/tabby-basket-VkVMjP/report.json) 和 [整理页截图](test-results/tabby-basket-VkVMjP/basket.png)：

- 新项目打开空篮子，右键一级入口固定选区、来源与项目；菜单打开后改变选区、焦点和项目再执行，仍保存原资料。
- 实际 Ctrl+Shift+Y 从本地终端与原生串口连续收集，Ctrl+Shift+B 打开页面；订阅终端输入流确认按键没有透传，添加时检查剪贴板与焦点未改变。
- 实际页面预览、编辑备注、自动保存备注后复制、调整顺序；检查剪贴板中的来源、文本和备注，编辑备注时不触发收集快捷键。
- 复用引用篮页面，返回最近打开它的终端；串口持续输出不改旧快照，切换项目不混合条目。
- 关闭测试应用并以新配置重新启动，恢复条目、备注和顺序；实际工具栏 provider 提供引用篮并保持无 Codex 启动图标。
- 篡改快照后复制失败且原剪贴板不变；移除和清空保留快照文件。仅清空操作的原生确认框返回值由测试替代，后续 UI 与后台操作均真实执行。

验收修复了后台返回后界面延迟更新的问题。空篮测试先等独立 Node 后台冷启动并完成读取，再检查界面在 3 秒内更新；预览、错误和清空结果也用短等待验证，避免依赖下一次鼠标事件或后台空闲定时器刷新。首次读取期间有加载提示。截图也经过目视检查。测试实例在本机 X11 会话下显式选择 X11 后端，生产启动参数未改动。串口使用伪终端，没有操作真实设备；测试没有向 Codex 发送提问。日常 Tabby/Codex 窗口保持运行，新版在下次启动时加载。

原有 Alt 数字/方向键与右键分屏的 5 项回归通过：[报告](test-results/tabby-pane-navigation-p72dYK/report.json)。

原有引用系统的 7 项检查通过：[报告](test-results/tabby-system-qNfRc9/report.json)。键盘事件到 PTY 回显各采样 30 次，原版 / 启用插件 / 串口与快照并行的中位数分别为 2.5 / 2.6 / 1.9 ms，p95 为 5.8 / 15.5 / 7.5 ms；不包含绘制时间，也不能据此保证零开销。

完整分屏的 10 项回归通过：[报告](test-results/tabby-panes-ThHVyl/report.json)。包含真实 Codex CLI 在分屏内运行、切换时保持同一会话与未发送草稿，以及后台伪串口收发。分屏输入的 20 个样本中位数 2.7 ms、p95 12.1 ms，出现一次 388.5 ms 最大值，记录保留，未以重复采样替换；该轮没有做出最大延迟保障。

### 精简终端正文右键菜单

TypeScript 检查与构建通过，真实 Tabby 的 4 项验收通过：[报告](test-results/tabby-context-menu-UPXcL0/report.json)。测试实际右击终端 DOM，仅在操作系统弹出菜单边界记录最终菜单，断言只有复制、粘贴、向右分屏、向下分屏、加入引用篮五项，且无多余分隔线；没有选区时复制与加入引用篮禁用。

随后执行实际菜单回调，验证选区进入剪贴板、粘贴文本到达原 PTY、引用篮保存菜单打开时的选区，以及两种分屏创建成功且原会话保持。分屏后的正文菜单仍为五项；实际顶部标签栏菜单组件仍提供另存为配置与完整引用入口。未改动 Tabby 的 PTY 收发、原生粘贴处理或网页右键菜单。日常窗口未重启，需下次启动加载。

### 直接引用到当前分屏的 Codex

TypeScript 检查、构建与 13 项领域/MCP 测试通过。新增测试覆盖普通与多行草稿、空的提示符首行、菜单/斜杠命令、控制字节不能提前终止粘贴包，以及非 Codex 进程不能成为目标。

真实 Tabby 1.0.238 + 本机 Codex 0.164.0 的 9 项验收通过：[报告](test-results/tabby-direct-reference-lm7TBj/report.json)。[并排草稿截图](test-results/tabby-direct-reference-lm7TBj/direct-reference.png) 供查看最终布局；另一次完整验收的 [截图](test-results/tabby-direct-reference-8FXHQU/direct-reference.png) 已目视检查。

- 在普通 Bash 中手动执行 `codex`，预先输入未发送的草稿，再从另一个终端按真实 Ctrl+Shift+Y；验证资料和原草稿都在 Codex 输入区，原会话、来源焦点和剪贴板保持。
- 同一接收分屏切换另一 Codex 标签后，实际右键“引用到 Codex”跟随当前项；隐藏标签不接收。
- 仅人为延迟快照保存，期间切换目标标签，验证既不改发新标签，也不输入旧的隐藏标签，而是复制备用。
- 在实际 Codex 模型选择界面中不投递；把接收分屏切到名为 Codex 的普通 Shell 也不投递。
- 同时显示两个 Codex 分屏时实际操作原生选择器，后续复用接收分屏，连续两次引用均进入同一个多行草稿。
- 终止测试中的真实 Codex 子进程，保留 Bash，确认后续引用不进入 Shell，也不自动改发另一存活 Codex。
- 另一个顶部工作页的引用不跨页写入；长日志通过快照路径进入真实 Codex 草稿，完整 Unicode 原文从文件读回核对。

实际记录的投递包仅有 bracketed-paste 起止标记，末尾没有提交用的回车；未向模型发送问题。复制/粘贴/分屏菜单 4 项回归通过（`test-results/tabby-context-menu-bTgip8`）；备用引用篮 8 项通过（`test-results/tabby-basket-WY9Umk`，测试为备用收集单独绑定 Ctrl+Shift+J）；Alt 标签切换和方向导航 5 项通过（`test-results/tabby-pane-navigation-A2uZ8V`）。

实现没有持续监控终端。显式引用时，允许最多约 250 ms 等待 TUI 缩放/焦点重绘，随后重新验证目标。输入状态判断仍是屏幕适配，不能保证与 Codex 内部状态原子同步；遇到未知界面退回复制。此轮没有测试 SSH/tmux 内的 Codex、真实硬件或模型任务执行中的全部审批界面。测试使用独立配置和进程组，未重启日常工作窗口。
