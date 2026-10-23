> Historical development record. Production now publishes our own captured template from `artifacts/latest/` with provenance. The previous official-snapshot delivery design described below has been removed; see ../README.md.

# 运行与一致性验证

日期：2026-10-23。

## 固定来源与官方交付

本次通过用户指定的 127.0.0.1:7897 代理重新获取官方 master，固定到 `15d269e3b49c681c1ab3e53af2e5181f01c71619`。采集核心、配套数据和测试来自同一提交。

官方原件标记为 CC `2.1.306`，有 37 个工具和三个模型变体，163943 字节，SHA-256 为 `f31a7d43eb821ead935deb3fd619aafe60512238d4556b752185a7c879132a5f`。默认 export 保留全部原始字节，含官方的 `_captured`，没有修改时间戳或重新序列化。已将导出文件与本次下载的官方原件直接比较，完全相同。

## 自动化验证

- TypeScript 主构建及官方参考最小依赖闭包构建通过。
- Node 22.23.0 下完整复跑：原 Dario 测试及官方 deferred-tools/defer-loading 回归共 761 项断言通过；21 个差分、运行时准备、同步和 CLI 集成用例全部通过。
- 独立实现与官方原始 bake 在相同输入上的产物、退出码、四模型调用及报告文件一致。覆盖正常烘焙、无漂移、标签漂移、提示词变化、未知工具丢失和变体失败。
- 35 个历史工具加 12 个观察工具的回归，双方都得到 37 个，12 个 deferred 工具被保留；defer_loading 提取、清洗与漂移检测一致。
- 客户端准备覆盖精确版本、缓存命中、latest 变化、网络失败、完整性失败、版本不符及任务期间二进制变化。
- 上游同步覆盖代码与原件一起更新、同提交幂等、缺失文件与新 schema 在写入前拒绝。
- CLI 集成覆盖 check/capture/label/export；本地观察与官方导出明确分开；篡改官方参考会阻止导出；旧 bundle 不会残留到无 bundle 的新导出中。
- 六个 GitHub 工作流通过 actionlint v1.7.7 静态检查。

## 真实最新客户端与采集

实际 npm latest 解析为 `2.1.309`。原生包 `@anthropic-ai/claude-code-darwin-arm64@2.1.309` 按 registry 给出的 SHA-512 核验，通过实际 `--version` 确认；二进制 SHA-256 为 `5eadc0009cdcdbc0d06e58110d7b2baf88ced6088b1c33a60a21217fe410619c`。测试安装于临时专用缓存，未替换个人全局客户端。

使用该二进制在临时副本运行真实四模型捕获和 bake，退出 0。因为验证主机是 macOS，仅显式使用原有 `--allow-non-linux-bake`；没有使用 `--allow-tool-drops` 或缺失变体放行。

本次实际捕获 12 个工具，保留 3 个跨平台、3 个交互、7 个配置和 12 个 deferred 工具，最终 37 个，三个模型变体完整。生成的观察原件为 163699 字节，SHA-256 为 `6d0b5c57045085589ada6cf7466b26bbd8e2bca435ceeb6c8447cec3e12a5a1d`。

这份实时 `2.1.309` 观察结果与官方 `2.1.306` 快照有真实提示词及其他差异，明确标记为 observation，不作为官方一致原件。即使在观察基线已经变化的同一目录执行默认 export，得到的仍是固定官方原始字节。

正式采集沿用 Linux runner。此处证明实际采集和工具保全正常运行，不声称 macOS 实时采集能逐字复现官方历史实验状态。

## 范围

本轮验证采集实现、产物一致性和客户端准备，不扩展到 Gateway 内部请求执行。GitHub 远程仓库、runner 和 Secrets 尚需部署配置，静态检查不等同远程任务已运行。

0.1.0 留下的 `local-2.1.304` 25 工具样本是曾经显式允许丢工具的历史验证文件，不能作为当前默认交付原件。当前默认交付目录为 `artifacts/official/`；新的本地采集样本位于 `artifacts/observations/`。
