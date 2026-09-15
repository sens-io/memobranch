# LLM Wiki 工作流

> 当前功能已进入实现验收阶段，完整状态以 `openspec/changes/align-karpathy-llm-wiki/` 的验证记录为准。下面描述可调用的接口，不代表发布验收已经完成。

Wiki 把原始资料编译成能持续修订的知识网络。`capture` 保存不可变证据；`wiki ingest` 结合规则、目录和已有页面提出变更；明确批准后，页面、目录和日志在同一个可恢复事务中提交。

## 三个工作流

| 工作流 | 默认行为 | 持久写入入口 |
| --- | --- | --- |
| Ingest | 读取资料，导航已有知识，生成多页待审计划 | `wiki apply`，或明确传入 `ingest --apply` |
| Query | 导航目录、读取页面、返回答案和实际引用版本 | `wiki file` 生成计划，再 `wiki apply` |
| Lint | 检查结构；`--semantic` 增加模型维护建议 | 检查返回的 `plans`，单独 `wiki apply` |

没有聊天模型时，证据捕获、原子记忆审核、目录、词法检索和结构 Lint 仍可用。摄取、模型导航问答和语义 Lint 需要配置 OpenAI 兼容的聊天模型；不需要 embedding 服务。模型输出不是新的独立证据。

## 从资料到知识

先配置 README 中的 `AMEM_LLM_*` 环境变量。以下例子使用当前目录下的独立 vault：

```bash
amem init ./knowledge
amem wiki migrate --root ./knowledge
amem wiki set-rules '保留来源、适用条件和不确定性；冲突并列展示。' \
  --purpose '维护项目架构与运维知识' --root ./knowledge

amem capture 'AtlasStore 支持每日快照。' --scope project --root ./knowledge
```

将上一步返回的真实 `evidenceId` 用于摄取。计划与答案可能包含受限内容，应保存在访问受控的位置，不要加入公开仓库：

```bash
umask 077
amem wiki ingest ev-REPLACE_WITH_RETURNED_ID --root ./knowledge > wiki-plan.json
# 阅读 JSON 中的 pages、snapshot、contextKeys 和来源，再明确批准
amem wiki apply --file wiki-plan.json --root ./knowledge
amem wiki catalog --root ./knowledge
```

摄取另一份相关资料时，模型会读取目录及相关页面，更新共享实体／概念和综合页面，而不只追加独立摘要。已有来源、条件、到期时间和更严格的分类会保留。依赖页面需要同步更新时，它们也会出现在待审计划中。

去重覆盖输入资料、已观察目录／页面、规则及配置版本。仅捕获尚未编译、也未被页面引用的无关原始资料，不使已完成摄取失效；目录中的新增页面及规则或配置变更会使相关计划重新验证。没有自定义规则时，运行时使用并记录 `builtin-wiki-rules-v1` 第 1 版。待审期间的配置变更、来源撤回或到期会使旧结果失效。

## 问答与显式回存

```bash
amem wiki query 'AtlasStore 的备份和恢复有什么限制？' \
  --root ./knowledge > wiki-answer.json
amem wiki file --file wiki-answer.json --title '备份与恢复比较' \
  --page-type comparison --root ./knowledge > wiki-file-plan.json
amem wiki apply --file wiki-file-plan.json --root ./knowledge
```

`query` 不创建 Wiki 页面。回存记录问题、回答、生成模型和时间、实际引用版本及不确定性，并继承所用知识的限制。修改返回 JSON、删除不确定性或改写引用会使校验失败；需要重新生成，不要手工修改校验字段。

计划和答案由 vault 本机的 `.amem/wiki-proof-key` 校验。该密钥是本地运行态，不进入 Git。跨机器复制的待审计划或答案、密钥丢失后的旧结果需要在目标 vault 重新生成；已批准的 Markdown 知识仍可正常同步和阅读。该校验不替代权限、证据、版本或事务检查。

## 检查、修复和撤回

```bash
amem wiki lint --root ./knowledge
amem wiki lint --semantic --root ./knowledge > wiki-lint.json
# 选择并阅读 plans 中的一项，将完整计划交给 wiki apply
amem wiki revoke 'entity:atlasstore' --reason '来源已撤回' --root ./knowledge
amem erase wp-REPLACE_WITH_RETURNED_ID --reason '删除受保护知识' --root ./knowledge
```

结构问题和语义执行状态分开返回。模型不可用或分析失败时，不会报告虚假的语义全通过；普通 Lint 不应用修复。撤回的页面及依赖它的知识不进入普通检索。密码学擦除需要 `admin` 权限和真正的加密页面；已导出的明文、第三方副本及原始证据不会因此被删除。

Lint 建议包含实际检查的 `pageVersions`，并报告公共目录缺失或被修改；检查本身不会重建目录。页面正文使用 CommonMark：行内、引用式链接及图片目标都接受校验，本地目标必须属于已声明的来源或关联页面。不支持原始 HTML（惰性注释除外）、本地文件 URL 或脚本 URL；代码块／行内代码中的链接示例不被当成可访问链接。

## 页面与文件

| 内容 | 位置和职责 |
| --- | --- |
| 原始证据 | `evidence/`，保持不可变 |
| 新 Wiki 页面 | `wiki/pages/wp-….md`，支持 source、entity、concept、synthesis、comparison、query |
| 目的与维护规则 | `wiki/.meta/wr-….md`，有作用域、敏感级别和版本 |
| 编译完成回执 | `wiki/.meta/wi-….md`，用于验证重复摄取，不作为事实或提示词 |
| 公共目录 | `WIKI.md`，仅列出 public/public 且来源链合格的页面 |
| 完整授权目录 | `wiki catalog`，按调用者权限生成分类、摘要与页面链接 |
| 操作日志 | `log.md`，追加可解析 `wiki-event`，记录时间、操作、匿名化页面身份及父提交；事件所在提交可通过 Git 历史定位 |

旧版原子记忆保持原 ID、路径、生命周期和审核入口。`wiki migrate` 只添加 Wiki 规则；旧配置或旧证据摘要仍使用 `config migrate`。只读查询不会自动迁移。

## 权限与接口对应

所有模型工具的身份、租户、密钥和授权由部署配置提供，不能通过参数提升。

| 权限 | CLI 子命令 | MCP / Harness 工具 |
| --- | --- | --- |
| `read` | `wiki catalog` / `rules` / `query` | `memory_wiki_catalog` / `memory_wiki_rules` / `memory_wiki_query` |
| `write` | `wiki ingest` / `file` | `memory_wiki_ingest` / `memory_wiki_file` |
| `review` | `wiki apply` / `revoke` | `memory_wiki_apply` / `memory_wiki_revoke` |
| `maintain` | `wiki migrate` / `set-rules` / `lint` | `memory_wiki_migrate` / `memory_wiki_set_rules` / `memory_wiki_lint` |

`ingest/file --apply` 同时需要 `write` 和 `review`。只授予 write、review 或 maintain 时，该操作内部可以读取它所需且获准的数据，但不会开放额外的外部读取权限。

目录中的标题和摘要也是知识输入，会参与派生页面的分类约束；模型没有读取全文，不代表目录元数据可以忽略权限。计划最多包含 40 个页面及依赖更新；导航可用 `--max-pages` 设置 1–50 的页面预算，输入同时受 vault 的字符限制约束。超预算会明确失败，不静默截断资料后声称编译完成。

取消、过期计划和恢复遵循既有事务边界：提交前失败回滚整组变更；进入不可逆提交阶段后先安全收尾，并在取消错误中报告已完成的提交。不要删除 `.amem/transactions` 或擦除恢复记录来绕过失败。
