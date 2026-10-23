# template_workflow 独立提取

日期：2026-10-23

范围按用户最终说明收敛：重点是独立项目能够正常运行。保留采集、清洗、漂移检测、自动重烘、标签同步和工作流；Gateway 仅核对生成模版的接收格式，Gateway 内部请求执行、构建验证和生产审核不属于本轮工作。

## 来源与目录

独立 Git 项目位于 `/Users/zoro/mh/template_workflow`。提取来源为当前 Dario 提交 `c528850aae26f1de845f364c430aeeb5b8d733ab`，不修改原 Dario 项目。

从原代码保留采集和清洗核心、原 bake/drift/label 算法、npm 静态漂移检测和相关测试。逐文件来源 SHA-256 保存在 `upstream-snapshot.json`。去除 `capture-and-bake.mjs` 对业务请求构造模块的间接依赖，只将工具保全常量 import 改为其原定义模块。

## 正常运行的交付

- Node CLI 入口提供 capture、check、label-sync、status、verify、export。
- 采集保留 nonce 归因、清洗和残留检查、平台/交互/配置工具保全、A/B 变体记忆、旧版本保护、Linux 烘焙门和未分类工具丢失保护。
- 单次启动包装层固定 Claude 的回环端点和模型，避免用户 settings 覆盖采集地址；个人配置保持不变。
- GitHub 工作流包含离线 CI、npm 漂移监视、真实模版漂移监视、存活检查和版本化模版产物发布。
- 自动化保留形状/标签漂移分流、仅瞬态字段变化不发 PR、过期 PR 两次复采、已知异常标记、PR 去重、告警恢复和可选 auto-merge。
- 原件保留 Dario `_schemaVersion: 3`。导出提供原始 JSON、SHA-256 与元数据；提供真实 source 时额外输出无损 `cc-template-bundle/v1` 包装。

## 验收

运行原算法测试及真实子进程集成测试；用已安装的 Claude Code 实际采集；验证导出摘要和原始字节；用指定 Gateway 分支的真实 Compile/ValidateExecutableBundle 检查生成产物。Gateway 接收后的内部转发、完整 wire 等价性、账号管理、验证构建身份和生产启用不扩展到本轮。

本机是 macOS，真实烘焙验证使用原脚本的明确放行参数，并在单独临时副本执行；交付的默认基线和保护规则保持原状。生产自动采集建议使用原规则要求的专用 Linux runner。

新建的是本地 Git 仓库。远程仓库、PAT、self-hosted runner 和 Actions 定时运行需要按 README 配置，未配置不宣称已经云端运行。
