> Historical development record. Production now publishes our own captured template from `artifacts/latest/` with provenance. The previous official-snapshot delivery design described below has been removed; see ../README.md.

# 提取边界

当前固定来源：`askalf/dario` 提交 `15d269e3b49c681c1ab3e53af2e5181f01c71619`。来源锁是实际版本的依据，定时 upstream-sync 可通过测试后的 PR 更新它。

生产 TypeScript 核心仍为 `live-fingerprint.ts`、`scrub-template.ts`、`cc-oauth-detect.ts` 和静态版本检查所需的 `cch.ts`。capture-and-bake、drift-report、label-sync、版本范围更新及配套纯函数按原文同步。

capture-and-bake 只调整一处 import：保全常量从原定义模块 live-fingerprint 取得，不加载业务请求构造器。DEFERRED_TOOLS 与其他三类保全集一起保留。清洗与捕获保留 defer_loading，该字段变化进入原漂移判定。

`test/reference/dario/` 的原始来源代码不做上述 import 调整，包含上游 cc-template/effort 的最小依赖闭包及官方 deferred 测试。参考实现只用于测试；同一组输入通过双方完整 bake 后，输出原件和结构化结果必须一致。

本地采集与官方交付分开：src/cc-template-data.json 为可变观察基线；reference/cc-template-data.json 为固定上游提交的原件。默认 export 读取并校验 reference，原字节复制；只有 --observed 才导出本地采集文件，且明确标记来源。不会通过删除提示词实验段落或替换时间戳凑出“相同”。

客户端准备在每个任务开始解析一次官方 npm latest，验证原生包完整性及实际版本，固定任务中的二进制。显式历史版本可重放；网络或校验失败不会回退旧版。缓存不修改个人全局安装。

GitHub 自动化保留原采集/标签/重烘机制，以及原脚本保护、PR 去重和复查。独立仓库使用自己的 runner、分支保护和原件 Release；官方参考更新由单独的 upstream-sync PR 承接。Gateway 内部请求执行、计费、账号与审核实现不在提取范围。

正式仓库集成使用 `template-workflow/` 子目录。上游两个读取提交基线的脚本将 Git 对象路径适配为 `HEAD:./...`，保证读取子项目自己的基线；远程 PR 基线的 GitHub API 路径带上模块前缀。相应适配记录在来源锁，并由嵌套仓库回归测试验证；运行算法保持一致。
