# 发布前许可证检查

检查日期：2026-10-26。范围是本仓库的源码、安装/构建脚本及下列上游版本；这是工程侧许可证核对，不构成完整法律意见，也不是全部传递依赖、商标或代码权属审计。

## 结论

Tabby 和本项目改造的 tabby-browser 都采用 MIT。它们允许修改、分发和商业使用，条件是随软件副本或实质性部分保留原版权及许可声明。因此，基于它们扩展后发布本身并未被许可证禁止，也没有要求把本项目全部代码采用同一许可证。

这不代表整个产品不存在法律风险。发布前仍需确定自有代码授权、保留实际分发组件的声明，并确认有权公开仓库中的代码与资料。

## 已核实的上游

| 组件 | 固定来源 | 许可与本仓库处理 |
| --- | --- | --- |
| Tabby | [v1.0.238 LICENSE](https://github.com/Eugeny/tabby/blob/v1.0.238/LICENSE) | MIT，版权为 Tabby Developers；保留至 `tabby/licenses/Tabby-MIT.txt` |
| tabby-browser | [fd1de863 LICENSE](https://github.com/karolnowacki/tabby-browser/blob/fd1de8632f15b793522623a29ebf968d0b8a5e3a/LICENSE) | MIT，版权为 Karol Nowacki；已保留完整许可，源码注明来源提交和改动，构建复制至 `dist/licenses` |
| Codex 生成协议类型 | [rust-v0.163.0 LICENSE](https://github.com/openai/codex/blob/rust-v0.163.0/LICENSE)、[NOTICE](https://github.com/openai/codex/blob/rust-v0.163.0/NOTICE) | 上游 Apache-2.0；在 `protocol/` 补充来源说明并保留上游许可和 NOTICE，不据此断言所有生成类型的独创性或法律分类 |

Apache-2.0 的再分发条款包括附带许可证、保留相关声明、在修改文件中标明改动，以及适用时保留 NOTICE。它不授予一般商标使用权。当前桌面功能调用用户自行安装的 Codex，仓库不包含 Codex 可执行程序。

## 当前发布方式

Git 仓库排除了 `.runtime/`、`node_modules/`、`dist/`、`data/`、`.terminal-references/` 和 `test-results/`。当前提交不包含完整 Tabby 安装包、依赖树、用户调试数据或运行凭据。安装器从官方发布地址下载固定版本并校验 SHA-256，在本机加载插件。

Tabby 上游源码没有被重编译或修改，插件会扩展界面并做运行时焦点等兼容处理。README 将这两点分别说明，避免让使用者误以为这是官方 Tabby 或 OpenAI 产品。

## 尚需处理的事项

1. **自有代码尚无统一许可证。** 根目录没有 `LICENSE`，`package.json` 也未声明 license。GitHub 公开可见不等于自动授予完整开源许可；参见 [GitHub 的许可证说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)。若权利人希望允许他人自由使用、修改和商用，可考虑 MIT；本次检查没有代替权利人作出授权决定。
2. **成品分发需检查实际包内容。** 若发布预编译插件或整套桌面安装包，需要为实际打包的 npm 依赖、Electron/Chromium、Node、字体和其他资源保留相应许可证与 NOTICE；单独附一份 Tabby MIT 不足以覆盖全部组件。当前 `tabby/build.mjs` 会把部分依赖打入 worker/MCP 文件，现有 `dist/licenses` 还不是完整依赖声明清单。本次没有完成成品包的完整许可审计。
3. **名称与图标独立处理。** 当前桌面入口使用 Tabby 名称和随包图标，仓库名称包含 Codex。上游开源许可不能自动等同于品牌、图标或官方背书授权；对外发布建议使用自己的应用名称与图标，以文字注明兼容 Tabby/Codex。README 已注明独立社区项目；本次未核定商标注册或品牌政策，也未更改用户桌面入口。
4. **确认公开权属。** 上游许可不解决本项目贡献的雇佣归属、公司保密义务或第三方资料授权。本次检查没有审定这些事项；实际调试日志和运行数据已由忽略规则排除。

建议先完成自有代码许可证选择，并按当前的“源码 + 官方下载脚本”方式发布；首次发布二进制 Release 时，再根据实际制品生成并核对完整第三方清单。重大商业发行或权属有争议时，应让专业法律人员复核。
