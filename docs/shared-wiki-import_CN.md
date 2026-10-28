# 明确批准的 Wiki 复制与人工整合（开发源码）

库、命令行、MCP、DeepSeek Harness 与网页的复制及人工整合功能已实现，接口正在验证。
实际浏览器及同一安装包的 Node 20/22 消费者检查已通过各自范围；完整最低版本适配器
集合仍有两项 CLI 等待观察失败，整批尚未验收，也未发布 npm。
[English](shared-wiki-import.md) · [路线图](remaining-roadmap.md) ·
[核心验证记录](shared-wiki-integration-core-verification-2026-10-26.md)

先复用[宿主配置的固定版本共享](pinned-shared-wiki_CN.md)。来源可以是本机资料库、
明确配置的云端服务或 Git 远端。请求只提交来源名称和刚才列表中的完整提交号，
不能指定来源路径、网络地址、密钥、身份或授权。开发测试使用合成资料库，不配置真实共享。
另一条本机分支需要由宿主明确配置一份独立检出目录及完整固定提交；本功能不抓取、
切换或合并 Git 分支，不修改共享授权。

## 先复制证据，再整合知识

```ts
import { MemoryVault, SharedWikiReader, SharedWikiImporter } from 'memobranch';
const vault = new MemoryVault('/absolute/destination', { principal });
const options = { configPath: '/absolute/host/shared-wiki.json' };
const reader = new SharedWikiReader(vault, options);
const selected = (await reader.catalog()).sources.find(source => source.id === 'team-wiki');
if (!selected) throw new Error('No configured readable source');
const importer = new SharedWikiImporter(vault, options);
const { plan } = await importer.prepare({
  sourceId: selected.id, expectedCommit: selected.commit,
  pageKeys: ['concept:deployment'],
  // includeSensitive: true, includeSecret: true,
  signal: new AbortController().signal,
});
// 完整检查来源、正文和目标分类，明确批准后另行复制。
const copied = await importer.apply(plan, { confirm: true });

const integration = await vault.wikiIntegrationPrepare({
  evidenceId: copied.evidenceId,
  pageKey: 'concept:deployment', expectedRevision: 0,
  title: 'Reviewed deployment guidance', summary: 'Human-authored integration.',
  body: '结合两侧资料人工编写的完整正文，保留适用条件与未解决的差异。',
  // sensitivity: 'secret', includeSecret: true,
  // status: 'conflicted', conditions: ['Only for this project'],
  // uncertainty: ['Still needs validation'],
});
console.log(integration.comparison, integration.preview);
// 完整检查导入材料、现有页面、所有修改及受影响页面，再单独批准。
await vault.wikiApply(integration.plan);
```

`principal` 是宿主提供的当前身份。复制预览和整合预览要求读取及写入权限；复制确认
另需审核权限。普通 Wiki 批准要求审核权限及方案对应的当前读取权限。预览可能初始化
现有本机签名密钥，但不写正式知识。签名不加密内容，也不会授予来源访问权限。
私密方案文件应保存在不纳入版本管理的位置，只允许当前操作者读取。

复制只保存不可变的已编译材料，不调用模型、不抽取候选、不创建或批准 Wiki 页面。
它保留固定提交、完整页面及修订、原始来源 ID 和哈希、规则引用，以及历史和当前支持
材料的适用条件、不确定性、冲突、开始时间和最早到期时间。原始资料没有一同复制，
也没有独立核实；不会复制 PDF 附件、来源密钥或绝对来源路径。相对页面和证据路径
仍用于追溯。目标默认分类采取更严格的范围和敏感级别，可以继续收紧，不能放宽。

确认复制时重新读取来源，检查固定提交、当前授权、密钥、内容、撤回和到期，不能
使用旧预览中的明文替代检查。来源与目标的锁不同时持有，最后等待也不能绕过有效期。
已进入可安全提交阶段的操作沿用现有恢复规则；发生取消或错误时先检查已完成操作，
再决定重试。复制完成后才发现权限或时间变化的错误，仅附带 `completedImport` 的
证据 ID、提交和重复标志，不附加材料明文。

相同复制方案成功重试仍重新检查来源，返回原证据、`duplicate: true` 和 `commit: null`。
无关记忆到期不会制造额外的维护提交；并发确认也只保存一份证据。删除远端授权
阻止新读取或复制，无法追回已保存的离线明文。已明确保留的副本仍可在当前本机权限、
密钥和有效期允许时整合，不再要求原远端授权，也不声称重新访问或核实了原始来源。

## 人工整合的规则

`expectedRevision: 0` 表示创建新页面；更新已有页面必须填写实际读取到的修订，不能
更换已有页面的用途。结果包含完整导入材料、当前目标及普通 Wiki 修改预览。
整合不调用模型，会创建有来源依据的摘要页（已有有效摘要则保留），并保留现有本机
证据、链接以及两侧限制。作者可以增加条件、不确定性、冲突或更严格的分类，但不能
借整合清除已有冲突。私密输入及输出均需明确选择并具备密钥。

修改、外来或过期的方案会被拒绝。成功的整合重试不会产生页面或提交，并重新检查
本机证据、当前权限、密钥、配置和时间。已签名的完成记录绑定实际相关页面、依赖、
证据和规则；只保留旧来源哈希不足以把已编辑的页面认定为未变化。后续无关知识和
其到期不会导致重复整合生成维护提交。这里不保证自动发现所有语义矛盾，也不保证
人工文本正确。普通记忆的抽取、提议、批准、合并、验证和读取均拒绝把导入材料当作
普通原始证据，避免丢失这些限制；单独的 Wiki 摄取流程仍可使用它。

## 命令行

宿主使用既有 `AMEM_SHARED_WIKI_CONFIG`，不会从请求中读取配置路径。
下列变量由操作者指定，方案文件应位于私密且不纳入版本管理的位置：

```sh
amem wiki shared-list --root "$DESTINATION"
amem wiki import-prepare team-wiki concept:deployment --root "$DESTINATION" \
  --expected-commit "$CATALOG_PIN" > "$PRIVATE_COPY_FILE"
# 完整检查复制方案，再单独确认。
amem wiki import-apply --root "$DESTINATION" --file "$PRIVATE_COPY_FILE" --confirm

# 人工填写 JSON：evidenceId、pageKey、expectedRevision、title、summary、body。
amem wiki integration-prepare --root "$DESTINATION" --file "$PRIVATE_DRAFT_FILE" \
  > "$PRIVATE_INTEGRATION_FILE"
amem wiki preview --root "$DESTINATION" --file "$PRIVATE_INTEGRATION_FILE"
# 逐页检查完整比较和预览，再单独批准 Wiki 修改。
amem wiki apply --root "$DESTINATION" --file "$PRIVATE_INTEGRATION_FILE"
```

复制预览必须提供来源名称、完整列表提交号和 1–25 个不同的页面键，可增加更严格的
`--scope`、`--sensitivity` 和 `--include-sensitive`／`--include-secret`。
人工整合 JSON 使用上方库示例的严格字段，可使用同样的私密选择参数；明确的命令行
选择覆盖文件里的对应选择。两种预览都不接受自动批准参数。复制确认和整合输入
要求有界本机 JSON 文件，不接受标准输入。命令取消会清理自己的等待，保留其他操作
持有的锁；已经可安全提交的操作仍遵循原有规则。

## MCP 与 DeepSeek Harness

| 工具 | 参数与结果 |
| --- | --- |
| `memory_shared_wiki_import_prepare` | `sourceId`、必填 `expectedCommit`、`pageKeys`，可选分类和私密选择。只返回完整已签名复制方案。 |
| `memory_shared_wiki_import_apply` | `{ plan, confirm: true }`，重新检查来源并保存证据，不批准 Wiki。 |
| `memory_wiki_integration_prepare` | 上方库输入去掉 JSON `signal`；返回完整材料、当前目标、预览和整合方案。 |
| `memory_wiki_preview` / `memory_wiki_apply` | 既有独立 Wiki 检查与批准，参数为 `{ plan }`；这里不接收复制方案。 |

复制工具仅在宿主已配置共享且当前身份具有所需权限时注册。Harness 也会隐藏无读取／
写入权限的整合工具，MCP 对已注册整合工具再次检查权限。已保留副本的整合不依赖
远端共享配置。取消由宿主和传输连接负责，不接受 JSON 的 `signal`、路径、身份、
权限或额外批准字段。

限制：每次 25 个请求页、50 个来源依赖页；完整材料、复制方案及已签名整合方案
最多 1,000,000 UTF-8 字节。整合最多影响 40 页，人工正文最多 100,000 字符，
适用条件／不确定性各最多 100 项、每项 4,000 字符，仍受完整字节上限约束。
命令行复制确认和整合输入文件连同排版最多 9 MiB；完整转义预览及可重新提交的
批准请求也必须在 9 MiB 内。原目录／经验输入保持 1 MB 限制。超限整体拒绝，
不截断后冒充完整内容，目标较低的证据限制继续生效。

兼容性：导入证据使用独立哈希域及 `digestVersion: 4`；整合增加 `integrate` 方案
和整合专用完成记录。旧程序会拒绝这些格式，应先停止旧读写进程。去掉版本、
保留 URI 或继承限制将导致验证失败。既有普通／PDF 记录无需改写。

## 网页管理

连接本机工作台后进入“知识导入”。“共享 Wiki”继续用于只读查看。
先预览来源、固定提交和完整复制材料，勾选确认已检查后明确复制；这里只保存证据，
不会自动生成或批准知识。随后填写返回的证据 ID，或此前保留的导入证据 ID，再填写
目标页面、实际修订及人工内容。完整检查保留材料、当前目标和所有修改，勾选第二个
审核框后单独批准 Wiki。已保留材料的整合不依赖远端共享配置。

修改来源、正文或分类会清除旧批准状态。停止、离开或断开会取消所属操作，晚到结果
不能恢复旧方案；草稿与方案只在当前页面内存中，不自动保存。保存结果未确认时先查
记忆库及运维记录；重试需要明确操作，且只重复原签名方案。网页继续使用既有 16 MiB
完整预览和请求限制，方案本身仍受更低的完整字节上限约束。
[HTTP、页面事件和实际浏览器检查](shared-wiki-web-verification-2026-10-28.md)已有记录，
[同一安装包的 Node 20/22 消费者检查](shared-wiki-package-verification-2026-10-28.md)已通过；
完整最低版本适配器集合的两项失败和整批验收仍待完成。

数据库变更：无。数据迁移：无。资料库配置版本变更：无。
不自动授予真实共享权限，不推送、不发布、不部署，也不安装导出的技能。
