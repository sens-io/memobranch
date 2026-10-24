# 本机／Git 固定版本 Wiki 共享（开发源码）

库核心及命令行、MCP、Harness 已实现，仍在完整保留检查和安装验证中；网页入口待实现。
尚未发布 npm，不新增云端账号，不导入、合并或批准知识，也不能追回离线明文。

```ts
import { MemoryVault, SharedWikiReader } from 'memobranch';
const caller = new MemoryVault('/absolute/caller-vault', { principal });
const shared = new SharedWikiReader(caller, {
  configPath: '/absolute/caller-vault/.amem/shared-wiki.json',
});
const sources = await shared.catalog();
const selected = sources.sources.find(source => source.id === 'team-wiki');
if (!selected) throw new Error('No readable configured source');
const view = await shared.snapshot({
  sourceId: selected.id, pageKeys: ['concept:deployment'], expectedCommit: selected.commit,
  // includeSensitive: true, includeSecret: true,
  signal: new AbortController().signal,
});
```

`principal` 是应用提供的可信身份，不接受请求覆盖。调用方首先要有自己资料库的
当前读取权限。宿主通过绝对路径的 JSON 文件明确配置来源和读者，不从模型回答
或来源内容自动生成授权；建议放在现有忽略目录 `.amem`，不作为正式知识提交。
程序不会自动创建该文件或给真实读者增加权限。

```json
{
  "version": 1,
  "sources": [{
    "id": "team-wiki",
    "title": "Team knowledge",
    "root": "/absolute/source-vault",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "vaultId": "replace-with-source-vault-id",
    "tenantId": "replace-with-source-tenant-id",
    "readers": [{ "id": "workspace-agent", "tenantId": "replace-with-caller-tenant-id" }],
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

使用双方配置中的真实 ID，以及来源当前 HEAD 的完整本地祖先提交。示例中的哈希
和 ID 需要替换。读者同时匹配调用方所属资料库的 `tenantId` 和身份 `id`，管理员
也不能跳过共享授权。来源权限取调用方权限与共享配置允许范围的交集；来源读取身份
保留调用者名字，绑定来源所属资料库，并且只有读权限。目录仅返回允许读者查看的
名称、固定提交和限制，不显示路径、密钥或其他读者，也不证明每页都可用。

机密来源可增加 `"masterKeyEnv": "TEAM_WIKI_MASTER_KEY"`，由宿主安全提供该环境
变量。文件只写变量名，不写密钥值；没有来源密钥配置时，不会使用 `AMEM_MASTER_KEY`
或调用方资料库的密钥。来源已有的每条记录密钥也必须可用，单独提供主密钥不能恢复
已擦除或缺失的记录密钥。本功能不导出来源密钥、本机 Wiki 证明密钥或其他私有运行
资料。敏感／机密内容仍需明确选择，不能通过选择提升权限。

读取继续检查双方当前身份、完整本地祖先关系、干净的受管内容、来源／规则、密钥、
撤回与到期。不会抓取、切换分支、修改引用或索引、调用模型或批准知识。对象缺失、
受管文件未提交、待处理事务／擦除均明确报错；恢复仍要单独执行。来源 HEAD 更新
不会悄悄改变固定提交，旧版本不可读时也不会退回其他版本绕过限制。
可选 `expectedCommit` 用来核对刚才列表中的版本：宿主已修改固定提交时，在访问来源
前拒绝读取；它不能选择或覆盖提交。省略时读取宿主当前配置的版本；网页始终发送
刚才显示的提交作为条件。

两份资料库的锁不会同时持有。返回前重新检查调用方、共享授权与密钥选择，最后
再检查当前／历史内容的到期和事实有效期，避免额外等待后返回已失效内容。
稍后的来源撤回若与读取重叠，沿用原有一致读取约定；后续读取必须遵守撤回。
修改授权影响新的或最后重新检查的操作，不能追回已复制的明文。本地副本在明确
更新前无法知道远端撤回，本功能不会自动抓取更新。

限制：配置最多 100,000 UTF-8 字节、20 个来源，每个来源最多 100 个不同的读者
身份／所属资料库组合；每次选 1–25 个不同页面；沿用快照的依赖、记录大小和本地
历史限制；完整共享 JSON 结果最多 20 MB。过大、无效、非普通文件、读取中替换或
符号链接配置会报错。方法支持真实的可选 `AbortSignal`，不接受 JSON 形式的身份、
路径、提交或取消覆盖。返回完整内容或拒绝，不截断冒充完整结果。

数据库变更：无。数据迁移：无。可选配置：上述明确共享文件及来源密钥变量；
开发和测试不会配置真实共享，执行测试仅使用合成资料库。

## 命令行与 Agent（开发源码）

启动者把 `AMEM_SHARED_WIKI_CONFIG` 设置为上述文件的绝对路径；请求不能提供
这个路径。调用者身份、所属资料库、读权限、作用域和敏感等级仍使用原有宿主环境
配置，不新增账号服务。

```sh
memobranch wiki shared-list --root /absolute/caller-vault
memobranch wiki shared-snapshot team-wiki concept:deployment --root /absolute/caller-vault
# 仍需当前权限及来源自己的密钥选择：
memobranch wiki shared-snapshot team-wiki concept:deployment --include-secret --root /absolute/caller-vault
```

宿主配置路径后，MCP/Harness 提供 `memory_shared_wiki_catalog`（无参数）和
`memory_shared_wiki_snapshot`（`sourceId`、`pageKeys`、可选私密标志）。Harness
还要求读权限才注册，插件宿主可用 `sharedWikiConfig` 指定路径，优先于环境变量；
MCP 在执行时仍检查读权限。请求不能选择提交、来源路径、密钥变量或身份。
可选 `expectedCommit`（命令行 `--expected-commit FULL_CATALOG_HASH`）只作上述
过期选择检查，仍拒绝普通 `commit` 覆盖字段。

两个工具均只读，包含转义的完整结果最多 9 MiB。命令行停止信号与工具取消只控制
本次操作；这里没有导入、合并、应用或增加授权的确认选项，这些属于之后单独实现
和审核的功能。
