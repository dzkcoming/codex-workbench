# Third-party code

`src/browser-tab.ts` adapts the WebContentsView lifecycle, positioning, coverage detection,
and Tabby component integration from [karolnowacki/tabby-browser](https://github.com/karolnowacki/tabby-browser),
commit `fd1de8632f15b793522623a29ebf968d0b8a5e3a` (0.2.0).

Copyright © 2026 Karol Nowacki. The original MIT license is in `tabby-browser-MIT.txt`.
The build copies this directory to `dist/licenses` for distribution with the plugin.

Local adaptations include mixed terminal/browser pane tabs, Chinese controls, local HTML
selection, pane focus, shortcut interception in the main process, a separate browser
session, modal hiding, and deterministic WebContents disposal. The adapted component is
built into this workbench plugin; installing a second `tabby-browser` plugin is not required.
