# 功能演示

[观看完整视频（MP4）](https://github.com/dzkcoming/codex-workbench/raw/refs/heads/main/docs/demo/workbench-demo.mp4)

![功能预览](preview.gif)

视频约 47 秒，使用独立 Tabby 窗口录制，带中文字幕，无音轨。MP4 约 456 KiB，另附 [字幕文件](captions.zh-CN.srt)。内容包括：

1. 同一顶部标签内创建分屏。
2. 选中右侧日志，按 Ctrl+Shift+Y 引用到左侧真实 Codex 草稿，保留已有输入。
3. Ctrl+Shift+T 在当前分屏新增终端，并继承工作目录。
4. 双击标签改名，Alt+1 / Alt+2 切换内部标签。
5. Alt+方向键切换分屏焦点。
6. 在分屏内打开本地 HTML。

串口和 GDB 的文字均是打印出来的模拟日志，没有连接真实设备；Codex 为真实 CLI，未向模型发送请求。操作由脚本驱动，使用真实终端和插件；分屏与网页打开调用插件入口，快捷键及改名使用键盘和鼠标事件。字幕属于后期说明。

视频使用 Tabby 1.0.238 / Codex 0.164.0。录制脚本为 [`tests/record-demo.mjs`](../../tests/record-demo.mjs)，依赖已有项目运行时、插件构建、Codex 登录、Linux X11 和 ImageMagick `import`。在仓库根目录运行：

```bash
source scripts/runtime.sh
TABBY_TEST_DESKTOP_AUTH=1 node tests/record-demo.mjs
```

脚本只捕获独立测试窗口，原始帧和字幕写入被 Git 忽略的 `test-results/demo-*`。分屏内标签切换后会话仍运行；自动引用的适用范围及回退行为见 [主 README](../../README.md)。
