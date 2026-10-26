# Tabby · Codex 引用

保留原版 Codex CLI，通过 Tabby 插件把其他终端的选区保存为固定引用。首版已在 Linux x86_64、官方 Tabby 1.0.238 和本机 Codex CLI 0.163.0 上验证。

## 开始使用

桌面和应用菜单已安装 **Tabby · Codex 引用**，也可以在项目根目录运行：

```bash
./start-tabby.sh
```

已打开的窗口需要在结束当前工作后重启，才会加载新版引用入口。

1. 在 Tabby 设置中打开 **Codex 引用**，选择你正在使用的本机项目目录。初始目录是本项目。
2. 在终端中进入项目目录，按平时的方式运行 `codex`。终端引用会附带选区内容或固定快照文件路径，便于在现有 Codex 会话中使用。
3. 在同一个顶部调试页中分屏：例如左侧运行 Codex，右侧打开 Shell、SSH、串口或 GDB。右侧选中内容，右键 **引用到 Codex** 或按 **Ctrl+Shift+Y**，内容会作为粘贴插入左侧 Codex 的当前输入位置。成功时保留来源焦点与剪贴板。
4. 可以连续引用其他终端，最后回到 Codex 补充问题并自行发送。左侧有多个 Codex 内部标签时，跟随当前显示的标签；隐藏标签不接收。多个可见 Codex 分屏时首次弹出选择，之后记住接收分屏。
5. 在 **设置 → Codex 引用** 查看和复制历史引用，也可以打开它在磁盘中的位置。

直接引用不发送回车、不清空已有草稿。短选区带简短来源与采样时间，超过 4000 字符时插入完整快照路径；每次仍保存不可变快照。快捷键设置中搜索 **Codex：引用选区到当前接收分屏** 可修改按键。原快捷键内部 ID 保留，因此已有 Ctrl+Shift+Y 设置无需迁移。

终端正文右键保持 **复制、粘贴、向右分屏、向下分屏、引用到 Codex** 五项；无选区时复制和引用禁用。顶部标签栏右键 **Codex 引用 → 选择接收引用的分屏…** 可更换接收分屏。原有配置管理、关闭和重命名等入口仍在标签栏及设置中，网页右键菜单独立。

直接投递首版支持 Linux 上本机终端中运行的 Codex，不依赖标签名称。通过本机前台进程、会话身份、粘贴模式、光标和当前屏幕布局保守检查目标；不是 Codex 的结构化编辑器 API。Shell、已退出/暂停的 Codex、SSH/tmux 内的 Codex、选择菜单或其他无法确认的界面只会得到“引用已复制，未直接投递”提示，用户自行回到 Codex 粘贴。窗口重启后重新识别接收分屏，不恢复旧进程绑定。

目标在触发操作时固定；异步保存期间切换目标内部标签、顶部工作页或退出会话会取消投递并退回复制，不改发给新标签。粘贴前会再次检查进程与界面，但纯终端集成不能与应用内部状态原子同步，也不能识别所有未来版本的界面。直接引用只处理这一刻的选区，不持续订阅输出，不改变普通输入或串口收发。

备用引用篮入口为 **顶部标签栏右键 → Codex 引用 → 加入引用篮（备用）**。点击顶部引用篮图标或 Ctrl+Shift+B 仍可预览、备注、排序和复制全部引用；备用收集默认不绑定按键，可在设置搜索 **引用篮：收集选区（备用）** 自行设置。原有单条“创建选区引用并复制”也保留在该子菜单。

引用篮按所选项目保存，重启后保留条目、已保存的备注和顺序。每个项目最多 50 条，每条备注最多 2000 个字符；移除或清空只改变篮子，不删除快照。多个窗口同时编辑时会检查版本，提示刷新后重试，避免旧页面覆盖新收集的条目。

整理页固定显示打开时的项目目录，切换引用项目后会打开对应项目的另一个篮子。预览最多显示前 16000 个字符；整篮复制中，每条不超过 4000 个字符且总内联内容不超过 16000 个字符，其余条目附完整快照文件路径。长日志没有截掉，Codex 可按路径读取；这要求 Codex 能访问所选的本机项目目录。

直接在普通终端运行 `codex` 也可以读取复制内容中的本地快照文件。需要只读 MCP 时，可单独运行：

```bash
./scripts/codex-with-references.py --workspace /绝对路径/你的项目
```

这个启动器通过本次进程的 `--config` 参数添加工具，保留用户的其他配置。全局 `~/.codex/config.toml` 不需要修改。Codex 正常处理自己的登录、工具、技能、审批和会话；启动器也支持透传参数，例如 `-- resume`。

## 每个分屏有自己的标签页

窗口顶部的 Tabby 标签页保留原来的用法。在一个顶部标签内，可以创建多个分屏；每个分屏又有独立的终端标签栏。例如左侧显示 Codex，右侧在 Shell、SSH 和串口之间切换，左侧不受影响。

1. 在终端正文右键，直接选择 **向右分屏** 或 **向下分屏**。它保留当前会话，在新分屏打开 Shell，并为各分屏提供独立标签栏。也可先点击窗口右上角的 **分屏内标签** 按钮（分栏窗口图标），给当前终端增加内部标签栏。
2. 在任意分屏继续右键分屏；分屏标签栏右侧 **⋯** 中也保留分屏入口。拖动分隔线可调整大小。
3. 点击某个分屏的 **＋**，或在该分屏按 **Ctrl+Shift+T**，只在这个分屏添加一个 Shell 标签。**⋯ → 在此分屏打开配置…** 使用 Tabby 的配置选择器打开已有 SSH、串口等连接；其中的 **在此分屏打开 Codex** 是可选的带只读引用工具的 CLI 启动入口。
4. 点击内部标签，或按 **Alt+1～9**，切换当前分屏内对应序号的终端；编号超出已有标签数时不操作。**Alt+←/→/↑/↓** 按位置切换到相邻分屏，目标分屏保留之前选中的标签；对应方向没有分屏时保持当前焦点。隐藏的会话继续运行和接收输出；选择日志并创建引用时，来源是当前分屏内当前终端。
5. **双击内部标签名称**打开改名框，按 Enter 保存、Esc 取消，也可通过右键菜单重命名。内部标签的 **×** 只关闭对应终端；最后一个标签关闭后移除该分屏。关闭确认沿用终端的 `canClose` 检查。顶部标签仍代表整个分屏布局，关闭它会关闭布局中的所有终端。

新建操作沿用 Tabby 的“新终端”快捷键设置，Linux 默认 **Ctrl+Shift+T**。当前处于内部标签容器或原生多分屏时，它在当前分屏新增内部标签；普通单终端页面仍新建顶部标签。原生多分屏会在首次使用该快捷键时自动出现内部标签栏。名称编辑框中不会触发新建终端。

通过快捷键、**＋** 或分屏操作新建本地 Shell 时，优先继承来源标签的**实时工作目录**，包括执行 `cd` 后的变化。读取失败时退回来源终端的启动目录，再退回引用项目目录。SSH/串口中创建本地 Shell 使用引用项目目录，不把远程路径当作本机路径。明确选择的连接配置，以及“打开 Codex”指定的项目目录，继续按各自配置启动。

Alt+数字在普通终端页面仍切换顶部标签；进入内部标签容器后切换当前分屏的内部标签。方向导航可在快捷键设置中搜索 **分屏：焦点** 后修改；其他内部切换、关闭快捷键可搜索 **分屏内标签** 后绑定。原生 Ctrl+Alt+方向键仍可导航分屏。新建分屏建议使用正文右键的 **向右分屏 / 向下分屏**；Tabby 原生的“复制/分屏”操作按恢复机制复制整个分屏标签组，会启动其中各个终端。

工作台已取消原生“重新排列分屏”的 **Ctrl+Shift** 绑定（`hotkeys.rearrange-panes: []`）。单独按住这两个键不再显示各分屏的名称拖动浮层，Ctrl+Shift+T 等完整快捷键继续使用。当前配置和新安装的初始配置均已更新；已经打开的窗口需要重新启动后加载该配置。

布局、各分屏的标签及选中项通过 Tabby 自带的恢复机制保存。恢复按各连接类型原有规则重连或启动进程，**不承诺退出应用后保留原进程或自动恢复 Codex 对话**；Codex 对话恢复仍使用其原生 `resume`。当前未提供内部标签跨分屏拖放排序和广播输入。

插件通过 `PaneTabsComponent` 容纳原生终端视图，未加入 PTY 收发代理。对 Tabby 1.0.238 的焦点兼容处理仅作用于启用了内部标签的分屏容器；升级宿主后应重跑布局集成测试。

插件文件已通过安装链接更新。已打开的 Tabby 进程仍使用加载时的插件；结束当前工作后重新启动 **Tabby · Codex 引用** 即可加载新版。

## 网页和本地 HTML

点击工具栏的 **打开网页 / HTML**（地球图标），或分屏的 **⋯ → 在此分屏打开网页 / HTML…**。它在当前分屏添加网页标签；普通单终端会获得内部标签栏，原终端保留。没有可用终端分屏时，创建新的顶部标签组。

- 地址栏支持 HTTP/HTTPS 地址、`localhost:端口`、`file://` URL 和本地绝对路径；也可点击 **文件** 选择 HTML。网页的相对资源仍按原地址解析。
- 网页和终端共用内部标签栏，支持双击改名、关闭、Alt+1～9，以及 Alt+方向键切换分屏。网页表单和页面状态在切换标签时保留。
- **Ctrl+Shift+T** 仍创建 Shell；当前是网页时，继承本分屏最近选中且仍打开的终端目录，没有来源时使用引用项目目录。**＋** 和新建分屏使用同一规则。
- 网页支持后退、前进、刷新，网页内容获得焦点时 **F5 / Ctrl+R** 刷新、**Ctrl+L** 聚焦地址栏。网页要求新窗口打开的链接会在原分屏新增网页标签。
- 恢复保存 URL、自定义名称和选中标签；重启会重新加载网页，不保存未提交表单或网页历史栈。本机服务仍需先启动。

网页使用独立的 WebContentsView 和浏览会话，关闭 Node 集成、开启 contextIsolation，不获得终端或 Codex 的执行权限。沙箱模式遵循宿主：本机 Linux Tabby 使用 `--no-sandbox`，因此不承诺操作系统级沙箱隔离；插件不改动宿主启动参数。分屏拖动和 Tabby 弹窗出现时，网页层暂时隐藏；关闭网页销毁它的 WebContents。PTY 收发路径没有增加代理，但网页自身仍会占用 CPU 和内存。

当前网页入口是轻量浏览面板，不提供下载管理、摄像头/麦克风授权或浏览器扩展；这些请求默认不启用。需要这些功能的页面请在系统浏览器使用。网页选区可通过原生复制交给 Codex，现有“创建固定引用”功能仍只针对终端选区。网页焦点下接管的是新建终端、内部标签切换和分屏导航的单段快捷键；不支持 Tabby 多段组合快捷键转发。

网页组件基于 [tabby-browser](https://github.com/karolnowacki/tabby-browser) 0.2.0 定制，已内置到本插件，无需另装。保留原作者 MIT 许可证，来源和改动见 [licenses/README.md](licenses/README.md)。

## 引用的含义

每份引用包含所选文本、终端名称、终端实例 ID、会话实例 ID、采样时间和 SHA-256。终端实例 ID 在当前窗口中的同一标签页生命周期内稳定，连接对象更换后使用新的会话实例 ID。

引用是**屏幕选区快照**，不是完整原始日志或实时屏幕。后续滚屏、终端改名和新输出不会覆盖旧引用。当前没有把屏幕选区伪装成原始字节的游标位置。

快照位于所选项目：

```text
.terminal-references/
  .gitignore
  basket.json                # 当前引用篮的条目、备注和顺序
  ref_时间戳_随机标识/
    metadata.json
    content.txt
    reference.md
```

目录默认仅当前用户可访问，快照文件为只读；目录中的 `.gitignore` 默认排除这些日志。每次创建先在临时目录完成写入和持久化，再发布完整引用。MCP 读取时验证文本的内容校验值。

每份选区最多 2 MiB，超限会明确提示，不会静默截断。较短选区也复制到剪贴板；较长内容通过快照文件或 MCP 分页读取。索引位置使用 UTF-16 游标，返回的游标不会切断 emoji 等代理对。

## 收发与生命周期

- 插件没有订阅终端连续输出，也没有安装输入中间件。选择引用前，键盘和设备数据继续走 Tabby 原有的收发路径。
- 只有创建、查看或读取引用时，才启动独立 Node 进程执行文件写入、校验和读取；空闲后自动退出。
- 关闭 Tabby 后，已经保存的快照仍可以由 Codex 读取。
- **Tabby 原生串口连接仍由 Tabby 持有，退出 Tabby 会关闭它。** 项目已有的独立采集服务仍可用于持续采集，本轮尚未将该服务接成 Tabby 的后台会话。不要让两者同时打开同一个串口。

只读 MCP 提供三个工具：

| 工具 | 功能 |
| --- | --- |
| `reference_list` | 按项目分页列出引用元数据 |
| `reference_read` | 校验并分页读取指定引用 |
| `reference_search` | 在指定引用内搜索字面文本 |

这三个工具没有终端输入、设备命令或文件写入接口。自动采集、实时 `@终端` 补全、自动插入 Codex 草稿、模型操作设备不属于本轮交付。

## 安装与开发

在本项目依赖及 Node 运行时已安装的环境中：

```bash
./setup-tabby.sh
```

脚本下载并校验已测试的官方 Tabby 安装包，在项目 `.runtime/tabby-app` 中解包；不运行系统软件包的安装脚本。插件通过符号链接安装到 `~/.config/tabby-codex/plugins/node_modules/tabby-codex-references`。工作台使用 `~/.config/tabby-codex` 作为自己的 Tabby 配置目录。

构建和检查：

```bash
source scripts/runtime.sh
npm run check:tabby
npm run build:tabby
npm run test:tabby
npm run test:tabby:system
npm run test:tabby:panes
npm run test:tabby:pane-actions
npm run test:tabby:pane-navigation
npm run test:tabby:pane-cwd
npm run test:tabby:browser
npm run test:tabby:basket
npm run test:tabby:context-menu
npm run test:tabby:direct-reference
```

本机若默认 npm 过旧，可像 `setup-tabby.sh` 一样使用 `~/.nvm/versions/node/v18.20.8/bin/npm`。构建使用项目运行时执行。Angular 与 Tabby 模块由宿主提供，插件不打包另一套 Angular。公开 npm 类型包落后于宿主版本，实际集成测试以 1.0.238 为准。

源码职责：

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 右键菜单、设置、快捷键注册和可选 Codex 启动器 |
| `src/reference-basket.ts` | 引用篮工具栏、快捷键、整理页面和异步任务队列 |
| `src/codex-reference.ts` | 当前工作页接收分屏、可见标签选择、直接投递与复制回退 |
| `src/codex-target.ts` | Linux 前台 Codex 识别、保守输入界面检查和粘贴控制字符处理 |
| `src/basket.ts` | 按项目保存引用篮、版本检查、备注排序和整篮复制 |
| `src/pane-tabs.ts` | 分屏内标签、原生终端视图容器、布局恢复与焦点适配 |
| `src/browser-tab.ts` | 网页标签、网页层尺寸/可见性、焦点和恢复 |
| `src/browser-host.ts` | Electron 主进程网页创建、同步快捷键拦截和新窗口路由 |
| `src/bridge.ts` | 按需启动记录进程，限制并发和等待时间 |
| `src/references.ts` | 固定快照、项目边界、内容校验和分页 |
| `src/worker.ts` | 插件与记录进程之间的本地请求协议 |
| `src/mcp.ts` | 原版 Codex 使用的只读 MCP |
| `../scripts/codex-with-references.py` | 启动原版 CLI，仅增加本次进程的 MCP 配置 |

部分 Tabby 官方构建关闭了 Electron 的 RunAsNode 功能，所以记录进程使用项目的独立 Node 运行时。`TABBY_REFERENCE_NODE` 可显式指定它，启动脚本已经设置。

## 增加一个独立插件

本插件导出 `ReferenceActionProvider`、`ReferencesService` 和 `ReferenceSummary`。其他 Tabby 插件可以注册一个 Angular multi provider，为固定引用增加操作，而无需接管终端收发。

可运行示例位于 [`examples/source-label`](examples/source-label/index.ts)，功能是复制引用的来源标识。完成构建后，在项目根目录执行以下命令并重启 Tabby：

```bash
ln -s "$PWD/tabby/examples/source-label" "$HOME/.config/tabby-codex/plugins/node_modules/tabby-reference-source"
```

随后历史引用旁会出现 **扩展操作**。示例默认未安装到日常配置；集成测试已验证两个独立插件之间的接口。新增扩展应把耗时处理放在后台，使用固定引用 ID 关联结果。

扩展示例和原版 Codex 终端界面启动的实测记录见 [`扩展验收`](../test-results/tabby-extension-4mO5hj/report.json) 与 [`Codex 界面截图`](../test-results/tabby-extension-4mO5hj/codex.png)。

## 验证记录

直接引用的 [9 项真实 Codex 验收](../test-results/tabby-direct-reference-lm7TBj/report.json) 通过：手动启动 CLI、已有草稿保留、当前标签跟随、异步切换取消、模型菜单拦截、普通 Shell 排除、多接收分屏选择、退出回到 Shell、跨工作页隔离与长日志文件引用。测试没有向模型提交问题；普通与多行输入区、控制字符和只读 MCP 等 13 项领域测试也通过。限制及回归记录见 [VALIDATION.md](../VALIDATION.md)。

引用篮的 [真实 Tabby 验收](../test-results/tabby-basket-VkVMjP/report.json) 覆盖本地/串口跨终端收集、快捷键不透传、焦点和剪贴板保持、预览备注排序、整篮复制、项目隔离、重启恢复及坏快照处理。[整理页截图](../test-results/tabby-basket-VkVMjP/basket.png) 已目视检查。完整测试边界和终端响应采样见 [VALIDATION.md](../VALIDATION.md)。

新建终端继承实际工作目录的 [六项验收](../test-results/tabby-pane-cwd-nByies/report.json) 通过：真实 `cd` 后按快捷键新建，并在新 Shell 中执行 `pwd -P` 验证，覆盖不同分屏目录、特殊字符路径、异步切换及读取失败回退。原有 [八项操作回归](../test-results/tabby-pane-actions-HpmGtk/report.json) 也通过。

正文右键分屏、Alt+数字切换内部标签、Alt+方向键导航与输入流隔离，已通过 [导航验收](../test-results/tabby-pane-navigation-I8mOdJ/report.json)；[新建/改名操作回归](../test-results/tabby-pane-actions-O8tMx8/report.json) 也通过。验收使用真实 Tabby 的按键、双击、DOM 焦点和状态断言，另检查 [三分屏截图](../test-results/tabby-pane-navigation-I8mOdJ/pane-navigation.png)。系统原生右键菜单通过真实菜单构建与菜单项回调验证。

Ctrl+Shift+T 的分屏内新增、普通页面顶部新增、自定义按键、双击中文改名、取消与恢复名称、编辑框隔离，均通过 [键盘与鼠标操作验收](../test-results/tabby-pane-actions-U8A4uB/report.json)。焦点处理修改后的 [十项布局功能回归](../test-results/tabby-panes-ZEtOnI/report.json) 也通过。

2026-10-26 的分屏内标签验收见 [布局测试报告](../test-results/tabby-panes-oK3esk/report.json)、[三个分屏截图](../test-results/tabby-panes-oK3esk/pane-tabs.png) 和 [原版 Codex 与串口并排截图](../test-results/tabby-panes-oK3esk/codex-pane-tabs.png)。覆盖：

- 移入分屏标签后原生会话及 frontend 对象保持不变，输入只进入选中终端，隐藏会话持续输出。
- 内部加号、独立切换、原有顶部标签切换、左右与上下分屏、大小调整及焦点导航。
- 当前内部标签的引用来源正确；原生串口使用伪终端验证后台接收、切回发送与引用。
- 原生恢复保留所有内部标签与选中项；关闭前检查生效，关闭单个标签或最后一个标签只影响相应终端/分屏。
- 原版 Codex CLI 在内部标签运行，切换后保持同一个会话及未发送草稿。本轮没有向模型提交该草稿。

分屏场景 20 个键盘到回显样本：中位数 5.5 ms、p95 8.4 ms、最大 24.4 ms，不包含绘制或显示器时间。原有引用插件的 [系统回归](../test-results/tabby-system-SvZ5oC/report.json) 也通过；该轮未安装插件/启用插件/串口与快照并行各 30 个样本，中位数分别为 3.1 / 3.5 / 4.1 ms。不同场景和时段的采样不能作为性能等价或零开销的保证。

核心测试通过：Unicode 与换行保持、快照互不覆盖、分页重组、内容修改检测、项目隔离、符号链接拒绝，以及真实 stdio MCP 的三个只读工具。

真实 Tabby 集成结果见 [`../test-results/tabby-system-mxbxFe/report.json`](../test-results/tabby-system-mxbxFe/report.json)，包含本地 PTY、Tabby 原生串口驱动连接伪终端、真实选区与菜单回调、剪贴板、历史引用页、后台记录进程和退出后的引用读取。没有打开实际开发板串口。

同机每种场景 30 个键盘样本，测量从 renderer 的 `keydown` 到同一终端会话的回显数据返回 renderer：

| 场景 | 中位数 | p95 | 最大值 |
| --- | ---: | ---: | ---: |
| 未安装本插件的 Tabby | 1.6 ms | 4.5 ms | 5.3 ms |
| 安装并启用本插件 | 1.7 ms | 2.4 ms | 10.6 ms |
| 另一路串口持续输出，同时记录快照 | 1.5 ms | 5.1 ms | 7.2 ms |

这是一次本机采样，不包含终端绘制或显示器扫描时间，也没有控制所有系统负载；较低的某个分位数不能解释为插件提高了性能。

原版 Codex 已实际调用两次 `reference_read`，正确读取来自 `build` 和 `dut-uart` 的不同证据，并成功恢复同一会话。全局配置文件内容和登录方式保持一致。见 [`codex-report.json`](../test-results/tabby-system-mxbxFe/codex-report.json) 与 [`实际回答`](../test-results/tabby-system-mxbxFe/codex-reference-answer.txt)。测试时清除了自动化环境注入、而用户桌面没有的 API key 环境变量，使用已有 ChatGPT 登录；正式启动器保留用户环境。

复现模型验收需要可用的本机 Codex 登录，并会产生一次读取和一次会话恢复请求：

```bash
source scripts/runtime.sh
node tests/tabby-codex.mjs test-results/本次系统测试目录/references.json
```

上游参考：[Tabby](https://github.com/Eugeny/tabby)、[插件开发接口](https://github.com/Eugeny/tabby/blob/master/HACKING.md)、[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)。
