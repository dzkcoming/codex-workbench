# Third-party code

The workbench runs the official Tabby 1.0.238 application. Its MIT license is
retained in `Tabby-MIT.txt` (Copyright (c) 2017 Tabby Developers).
The installer downloads and extracts the upstream application; it does not
rebuild or patch the Tabby source tree. This plugin contains runtime integration
and compatibility adaptations. This is an independent community project.

These notices cover the named upstream projects, not a complete inventory of
every dependency in a distributable application or bundled plugin. The
workbench's own code has not yet been assigned a repository-wide license.

`src/browser-tab.ts` adapts the WebContentsView lifecycle, positioning, coverage detection,
and Tabby component integration from [karolnowacki/tabby-browser](https://github.com/karolnowacki/tabby-browser),
commit `fd1de8632f15b793522623a29ebf968d0b8a5e3a` (0.2.0).

Copyright © 2026 Karol Nowacki. The original MIT license is in `tabby-browser-MIT.txt`.
The build copies this directory to `dist/licenses` for distribution with the plugin.

Local adaptations include mixed terminal/browser pane tabs, Chinese controls, local HTML
selection, pane focus, shortcut interception in the main process, a separate browser
session, modal hiding, and deterministic WebContents disposal. The adapted component is
built into this workbench plugin; installing a second `tabby-browser` plugin is not required.
