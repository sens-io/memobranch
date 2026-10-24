# 明确确认的编译 Wiki 导入（开发候选）

库的复制操作已实现，仍在验证。人工整合与 CLI／MCP／Harness／网页导入入口待完成，
本批尚未验收，未发布 npm；不做 Git 分支合并或云端共享。

沿用[宿主固定版本共享配置](pinned-shared-wiki_CN.md)。请求不能指定来源路径、密钥、
身份或授权。真实共享须由启动者另行配置，开发仅使用合成资料库。

```ts
import { MemoryVault, SharedWikiReader, SharedWikiImporter } from 'memobranch';
const vault = new MemoryVault('/absolute/destination', { principal });
const options = { configPath: '/absolute/host/shared-wiki.json' };
const reader = new SharedWikiReader(vault, options);
const selected = (await reader.catalog()).sources.find(source => source.id === 'team-wiki');
if (!selected) throw new Error('没有可读的已配置来源');
const importer = new SharedWikiImporter(vault, options);
const { plan } = await importer.prepare({
  sourceId: selected.id, expectedCommit: selected.commit, pageKeys: ['concept:deployment'],
  // includeSensitive: true, includeSecret: true,
  signal: new AbortController().signal,
});
// 先检查完整计划、来源、正文和目标分类，再单独确认复制。
const captured = await importer.apply(plan, { confirm: true, signal: new AbortController().signal });
```

准备需要读、写权限；确认导入另需读、写、审核权限。精确重试仍检查当前来源，返回
`duplicate: true`、`commit: null`；无关记忆到期不会让重复导入产生刷新目录的提交，
并发相同确认只保留一份资料。准备可能初始化已有的本机签名密钥，不修改正式文件。
计划包含完整私密正文，应保存在私有位置；签名不加密，也不授予读取来源的权限。

复制资料保留固定提交、页面版本及完整正文、原始来源 ID／哈希和规则引用；正文明确
说明这是编译结果，未复制或独立验证原始资料，离线明文不能追回。不复制 PDF 原件、
来源密钥或本机路径。限制同时考虑所选历史页面和当前页面：目标默认采用保守分类，
可选更严格分类，不能扩大范围或降低敏感等级。旧版原先是 internal、当前支持已是
secret 时，复制仍须为 secret，明确选择机密并具备目标加密密钥。条件、不确定内容、
冲突及最早到期时间由程序保留，模型遗漏也不能删除。到期后的原始导入资料仍可作为
历史查看，但不能支持当前可读的 Wiki 知识。

导入只保存资料，不调用模型、提取普通记忆或批准 Wiki。之后可明确使用已有的
`wikiIngest` → `wikiPreview` → `wikiApply` 流程，限制仍须保留；人工整合准备属于
本批后续实现。普通记忆的提取、提议、批准、整合、验证和读取拒绝引用导入资料，
避免旧流程丢掉限制。另一个分支须由宿主明确配置单独的本机 checkout，不自动获取、
切换或合并 Git 分支。

确认时重新读取来源、核对固定版本、完整资料、当前授权／密钥、目标配置和签名。
宿主绑定或密钥选择变化、修改／外来计划、当前撤回／到期、脏来源或缺失密钥均拒绝，
不会退回预览中复制的明文。来源与目标锁不会同时持有，最后等待目标库也不能越过
来源有效期。事务已准备好后沿用已有的安全提交与恢复；取消时先检查已提交信息再
决定重试。已完成复制的离线资料不会因为来源之后变化而自动删除。

限制：25 个请求页面／50 个依赖页面，完整资料和计划分别最多 1,000,000 UTF-8 字节，
同时遵守目标更低的内容限制、100 项继承条件／不确定内容及已有字段限制；完整返回
或拒绝，不截断。长普通记忆支持在整体上限内完整保留。

兼容性：导入证据使用独立哈希域和 `digestVersion: 4`。旧程序会拒绝新格式，不能把它
静默当普通原始证据使用；启用导入前须停止旧读写程序。去掉版本、URI 或继承格式会
验证失败。普通／PDF 证据格式保持原样，不更改数据库，不自动迁移数据或升级库配置
版本。未配置真实授权、推送、发布、部署或安装导出技能。
