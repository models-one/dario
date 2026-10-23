# template_workflow

正式仓库 `models-one/dario` 中的独立 Dario Claude Code 模版采集与漂移工作流，目录为 `template-workflow/`。采集、清洗、工具保全、模型变体、漂移判定、重烘和标签同步使用 `upstream-snapshot.json` 锁定的官方实现。

**默认导出与该提交中的 Dario 官方模版逐字节一致。** 本地实时采集另存为观察结果；相同客户端版本也可能因远程配置产生不同提示词，观察结果不会冒充官方原件。

## 开始使用

需要 Node.js 22 或更高版本、npm、Git 和 tar。

```sh
cd template-workflow
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run status
npm run export
```

默认交付文件在 `artifacts/official/`：

- `cc-template-data.json`：官方原始字节，不重新序列化。
- `SHA256SUMS`：原件摘要。
- `metadata.json`：官方来源 commit、版本、摘要和 `origin.type=dario-official`。

导出前会校验锁定的参考长度和 SHA-256；文件损坏或来源不匹配时失败，不降级导出另一份文件。`reference/cc-template-data.json` 是官方原件；`src/cc-template-data.json` 是本地采集使用的可变基线，两者在一次上游同步后相同，但采集后可以不同。

```sh
npm run verify:upstream  # 核对固定来源代码和官方参考
npm run verify:parity   # 比较本地观察与官方原件，字节不同时返回 2
```

## 更新到 Dario 最新实现

```sh
TEMPLATE_HTTP_PROXY=http://127.0.0.1:7897 npm run sync:upstream
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run export
```

`sync:upstream` 从官方 master 固定一个实际 commit，整体更新源码、配套测试、官方模版和来源锁。代码与模版不会来自不同提交。重复同步同一提交不改版本；更新会递增项目版本。相关跟踪文件有未保存修改时停止，避免覆盖本地观察或源码工作。

当前基准为 `15d269e3b49c681c1ab3e53af2e5181f01c71619`。官方原件标记为 CC `2.1.306`，37 个工具；它不一定与 npm 最新客户端同时发布。实际值始终以来源锁和 status 为准。

## 实时采集

```sh
npm run prepare:claude
npm run check
npm run capture
npm run export -- --observed
```

默认在每个任务开始查询官方 npm `latest`，选择精确版本的原生客户端包，验证 SHA-512、二进制 SHA-256 和实际 `--version`。客户端安装在项目专用缓存中，个人全局 Claude 不变。下载或核验失败会停止，不退回旧版继续采集。

自动任务的 check、四个模型捕获与 bake 共用同一份已校验客户端。缓存命中也检查版本和摘要。默认缓存目录是 `~/.cache/template-workflow/claude`，可设置 `TEMPLATE_CC_CACHE_DIR`。下载代理使用 `TEMPLATE_HTTP_PROXY`；回环采集绕过代理环境。

正式烘焙沿用原 Dario 的 Linux 限制，建议专用、正常登录的 Linux runner，以取得对应环境的实际远程配置。本地 macOS 调试可明确使用 `--allow-non-linux-bake`，但自动工作流不会默认放行平台、工具丢失或变体缺失。

需要固定版本重现时：

```sh
npm run check -- --cc-version 2.1.306
# 使用明确指定的已有客户端时，仍核对实际版本：
TEMPLATE_CLAUDE_BIN=/absolute/path/to/claude TEMPLATE_CC_VERSION=2.1.306 npm run check
```

固定版本重现仍要求基线适用。比基线更旧的客户端会触发原有降级保护。

采集使用带 nonce 的回环端点。单次 `--settings` 固定端点和模型，避免用户配置覆盖采集地址；不会修改个人 settings，也不会删改提示词以制造官方一致的假象。

退出码沿用 Dario：0 完全匹配；1 基础设施失败；2 形状漂移；3 标签漂移；4 未分类工具丢失、拒绝烘焙。每轮捕获基准加三个模型变体；工具完整度来自捕获与历史基线的分类保全，包含官方新增的 deferred tools。

`capture` 写入 `src/cc-template-data.json`。`export --observed` 写入 `artifacts/observations/latest/`，明确标记 `origin.type=observation` 并记录与官方参考是否字节一致。默认 export 始终交付官方原件，不会因一次本地采集改变。

标签同步只在实际检查确认形状无变化后使用：

```sh
npm run label-sync -- <实际检查过的CC版本>
```

它更新观察基线及发布元数据，不修改官方参考。不要用版本标签替代一次真实采集。

## Gateway 交付

产物保持原生 `_schemaVersion: 3`，不转换成旧 Gateway schema。需要 `cc-template-bundle/v1` 包装时提供真实 source：

```sh
npm run export -- --source /absolute/path/to/source.json
# 本地观察结果必须明确选择：
npm run export -- --observed --source /absolute/path/to/source.json
```

source 字段见 `docs/gateway-source.example.json`。其 CC 版本必须与原件一致；官方原件导出还要求 Dario commit 与来源锁一致。Base64 解码后的字节与原件相同，摘要针对实际交付字节计算。

本项目只处理产物接收格式，不修改 Gateway 内部转发或审核实现。

## GitHub 工作流

正式仓库默认分支为 `master`，实际生效的工作流位于仓库根 `.github/workflows/`：

- `template-workflow-ci.yml`：Node 22/24 构建、来源校验、原 Dario 测试、同输入 bake 对照、命令链和产物验证。
- `template-workflow-upstream-sync.yml`：每小时 `:23` 检查官方更新，同步核心、基线及参考，测试后生成 PR。
- `template-workflow-npm-drift.yml`：每小时 `:00` 检查 npm 版本和静态漂移。
- `template-workflow-capture.yml`：每小时 `:41` 准备最新客户端，检查并重烘本地观察基线，生成漂移/标签 PR，保留过期 PR 两次复采确认。
- `template-workflow-liveness.yml`：每两小时监视采集任务，8 小时没有成功运行则告警。
- `template-workflow-release.yml`：官方参考或来源锁合入后，测试并发布官方原件与摘要。观察模版 PR 不会触发官方原件发布。

主 CI 与官方产物 Release 使用 GitHub 托管 runner。真实采集需要专用 Linux self-hosted runner，默认标签 `template-workflow`，安装 Node/npm/Git/tar/gh，准备正常可用的 Claude 登录环境。准备完成后设置仓库变量 `TEMPLATE_CAPTURE_ENABLED=true`；该变量控制定时采集与其存活监视，手动 dispatch 仍可显式运行。

可配置变量：`TEMPLATE_RUNNER_LABEL`、`TEMPLATE_HTTP_PROXY`、`TEMPLATE_CC_CACHE_DIR`。客户端版本默认 latest；`TEMPLATE_CC_VERSION` 或 `TEMPLATE_CLAUDE_BIN` 只用于明确固定环境，指定二进制仍要匹配要求版本。

可设置 secret `CC_DRIFT_BOT_PAT`（Contents、Issues、Pull requests 与 Actions 所需权限）。没有 PAT 时使用 GITHUB_TOKEN；创建 PR 需要仓库允许 Actions 创建 PR。维护工作流会显式 dispatch `template-workflow-ci.yml` 检查 bot 分支，避免依赖机器人创建 PR 的事件级联。需要自动合入时，先配置分支保护与 required checks，再启用仓库 auto-merge 和 `TEMPLATE_AUTO_MERGE=true`。

Release 标签使用 `template-workflow-v<版本>`，与父仓库 Dario 的版本标签分开。仓库级部署与验证说明见 `../docs/template-workflow.md`。

## 来源与测试边界

`upstream-snapshot.json` 记录逐文件来源摘要。生产核心只保留一处已声明适配：将 bake 所需常量 import 指向其原定义模块。`test/reference/dario/` 保存固定提交的未修改原始最小依赖闭包，仅用于测试。

同输入测试执行双方实际 bake，比较写出的完整 JSON、退出码、四模型调用序列及报告文件；固定时钟与重放输入仅用于测试。延迟工具和 defer_loading 还运行官方原有回归。`test/fixtures/seed-template.json` 保留旧 35 工具样本，用于证明新逻辑能与 12 个捕获工具合并成 37 个；37 不作为未来所有版本的固定标准。

运行验证见 `docs/verification.md`，边界见 `docs/extraction.md`。MIT 许可证保留在 `LICENSE`。
