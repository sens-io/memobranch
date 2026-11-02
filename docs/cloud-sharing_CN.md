# 云端共享：开发候选版本

已确认同时支持自托管服务和 Git 远端共享。当前分支包含**自托管读取服务**、**云端客户端**和 **Git 缓存读取**。
第 2 版客户端配置及现有读取入口已通过 [客户端检查](cloud-client-verification-2026-10-26.md)；
[Git 库与管理页面检查](git-shared-wiki-verification-2026-10-26.md)也已通过本地验收；
Git 的 CLI/MCP/Harness 专项检查与服务启动配置命令已通过[组合本地验证](cloud-host-verification-2026-10-26.md)：
两种 Git 默认分支、最低 Node 20，以及同一安装包在 Node 20/22 下均通过；整批已通过独立复核并完成本地验收。
这不代表已经发布 npm 或部署，后续路线图批次仍待完成。
完整约束见 [OpenSpec 设计](../openspec/changes/add-cloud-shared-wiki/design.md)，
已执行的检查见 [服务验证记录](cloud-read-service-verification-2026-10-26.md)。

## 账号与授权

服务使用已经初始化的资料库。每个账号指定一个用于识别读取者的资料库，以及现有第 1 版
[本机共享配置](pinned-shared-wiki_CN.md)。账号 ID 必须出现在该文件的读取者列表中，租户使用
读取者资料库的租户。每个来源另外固定来源资料库和租户、完整版本、密钥环境变量和分类上限。
服务不会自动增加授权；账号始终只能读取，即使运行服务的人是管理员。

私有账号文件示例（开发过程没有创建真实账号）：

```json
{
  "version": 1,
  "accounts": [{
    "id": "team-reader",
    "tokenSha256": "<64 位小写十六进制摘要>",
    "root": "/srv/memobranch/reader-broker",
    "vaultId": "<已有读取者资料库 ID>",
    "tenantId": "<已有读取者租户 ID>",
    "sharedWikiConfig": "/srv/memobranch/private/shared-wiki.json",
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

运维人员可以在本机生成随机访问凭据及其摘要：

```sh
node --input-type=module -e 'import { randomBytes, createHash } from "node:crypto"; const token = randomBytes(32).toString("base64url"); console.log(JSON.stringify({ token, tokenSha256: createHash("sha256").update(token).digest("hex") }));'
```

私下分发原始凭据，账号文件只保存摘要。两者都不要放进仓库、URL、截图或浏览器存储。
删除账号或更换摘要会阻止后续读取。账号和来源配置每次请求都会重新检查；账号 ID、摘要必须
分别唯一。账号文件最多 100 个账号、100000 字节，必须是普通 UTF-8 文件，文件本身不能是
符号链接。配置应放在 Git 跟踪内容之外，并以原子替换方式更新。

## 本机服务配置命令

以下命令属于开发源码，不代表已经包含在公开 npm 版本中。先构建当前源码。
四条命令都要求管理员（`admin`）权限；只有读写权限的 Agent 不能操作服务配置，命令也不会
修改当前操作者的权限设置。
在项目根目录运行以下示例，明确使用当前源码构建的 `dist/cli.js`，避免调用到旧的全局 npm 安装。

在操作者的私有终端中生成尚未生效的凭据及摘要：

```sh
node dist/cli.js cloud credentials
```

输出包含 `token` 和 `tokenSha256`。命令不会保存文件或增加授权。
将令牌私下交给指定读者，服务账号文件只保存摘要。使用摘要生成配置模板：

```sh
node dist/cli.js cloud account-template --id team-reader \
  --broker-root /srv/memobranch/reader-broker \
  --sources-config /srv/memobranch/private/shared-wiki.json \
  --token-sha256 '<64 位小写十六进制摘要>' \
  --scopes project --max-sensitivity internal
```

用于识别读者的资料库必须已经存在，账号 ID 必须匹配来源文件中已有的读者授权。
资料库与租户 ID 从真实配置读取，不会编造。模板只包含一个账号、私有路径和摘要；核对后再由
操作者明确保存为服务账号文件，并设置私有文件权限，例如 0600。已有账号文件需要明确加入这条
账号记录并保留其他账号；模板不会自动合并或修改授权。检查过程仍使用既有的本机读取锁。

检查配置，再在前台启动服务：

```sh
node dist/cli.js cloud check --accounts /srv/memobranch/private/cloud-accounts.json
node dist/cli.js cloud serve --accounts /srv/memobranch/private/cloud-accounts.json
```

检查结果只列出账号名称与当前可读来源数量，不显示摘要或路径；数量为零时如实显示零，不代表
页面已经可读或能解密。服务端来源只能使用本机配置。未知、重复、缺少值的选项和多余参数会被拒绝。
收到 SIGINT 或 SIGTERM 后，服务会结束自己启动的读取和连接，包括启动检查过程；不会安装后台服务。

启动时只输出 `status` 和 `url`。可选参数有 `--host`、`--port`、`--public-origin`、
`--tls-certificate`、`--tls-key`、`--request-timeout-ms`、`--max-concurrent`、
`--per-account-concurrent`、`--requests-per-minute` 和 `--per-account-requests-per-minute`，
采用下方库接口相同的范围与默认值。非本机监听必须提供 TLS 证书、私钥和明确的 HTTPS 地址。
服务保留启动时操作者的租户、范围和敏感级别上限；运行中把账号文件改为更宽权限，也不能超过这个上限。
修改启动者上限需要重启。库接口也可明确传入 `operator` 身份；原有可信本机程序省略该字段时保留原行为。

轮换凭据时，先生成新值，再由操作者用原子文件替换方式更新该账号的摘要，并私下更新客户端环境中的令牌。
撤销时明确删除该账号。账号和来源授权在每次请求中重新读取；配置变化也会阻止旧配置下组装的内容继续返回。

## 库接口启动

在当前源码目录执行 `npm run build` 后，宿主程序可以使用本地构建。以下示例不表示已发布的
npm 版本包含此功能：

```js
import { startCloudWikiServer } from './dist/index.js';

const service = await startCloudWikiServer({
  configPath: '/srv/memobranch/private/cloud-accounts.json',
  // 默认只监听 127.0.0.1，自动选择端口。
});
console.log(service.url); // 不返回凭据或账号信息。
process.once('SIGINT', () => { void service.stop(); });
```

公开监听必须提供 HTTPS 证书、私钥和公开地址：

```js
const service = await startCloudWikiServer({
  configPath: '/srv/memobranch/private/cloud-accounts.json',
  host: '0.0.0.0', port: 8443,
  publicOrigin: 'https://memory.example.com:8443',
  tls: {
    certificatePath: '/srv/memobranch/private/fullchain.pem',
    keyPath: '/srv/memobranch/private/privkey.pem',
  },
});
```

证书和私钥各不超过 1000000 字节，必须是普通文件，更换后需重启服务。客户端正常验证证书，
不能关闭验证。公开地址同时确定请求中允许的 Host；服务不信任转发头，拒绝带 Origin 的浏览器
直接访问。访问凭据应由宿主客户端保管。本机管理网页继续只在本机运行。

## 读取接口

| 接口 | 内容 |
| --- | --- |
| `GET /healthz` | 无需凭据，只返回简单健康状态，不返回账号或资料库信息。 |
| `POST /v1/shared-wiki/catalog` | 访问凭据加 `{"attenuation":{"scopes":["project"],"maxSensitivity":"internal"}}`，返回可读取的来源名称和固定版本。 |
| `POST /v1/shared-wiki/snapshot` | 上述限制加 `sourceId`、1–25 个不同的 `pageKeys`、必须填写的完整 `expectedCommit`，以及可选的 `includeSensitive`、`includeSecret`。 |

POST 需要 `Content-Type: application/json` 和恰好一个 `Authorization: Bearer …` 请求头。
`attenuation` 表示本次读取愿意使用的更低权限，只能缩小账号权限。服务在解密前检查账号和
来源的上限及显式私密内容选择。请求不能指定路径、账号、租户、授权、命令或密钥；未知字段、
重复 JSON 字段和无效 UTF-8 都会被拒绝。

读取结果包含完整 `view`、综合历史与当前限制的 `support`，以及最多 30000 毫秒的
`validForMs`。它不是可重复使用的授权凭据；后续客户端必须从请求开始的单调计时计算剩余
有效期。每次确认导入都要重新读取并检查授权。读取本身不会复制证据、合入知识、更新版本或批准。

默认限制：输入 65536 字节、完整输出 21000000 字节、请求 30 秒、全局并发 16、每账号并发 2、
全局每分钟 120 次、每账号每分钟 60 次。频率限制允许初始额度内的突发请求；健康检查也消耗
全局额度。宿主的 `limits` 可在以下范围设置：超时 100–120000 毫秒、全局并发 1–32、账号
并发 1–8、全局每分钟 1–6000 次、账号每分钟 1–600 次。断开连接、超时和停止服务会取消工作。
错误只返回安全的错误代码；输出过大时整体拒绝，不返回残缺页面。

## 配置云端客户端候选实现

客户端使用另一份私有宿主配置。请求只选择来源名称和页面，不能提供地址、凭据、路径或身份：

```json
{
  "version": 2,
  "sources": [{
    "transport": "cloud",
    "id": "team-wiki",
    "title": "Team Wiki",
    "origin": "https://memory.example.com:8443",
    "remoteSourceId": "published-team",
    "credentialEnv": "TEAM_WIKI_TOKEN",
    "commit": "<来源完整固定版本>",
    "vaultId": "<来源资料库 ID>",
    "tenantId": "<来源租户 ID>",
    "readers": [{ "id": "local-reader", "tenantId": "<本机客户端租户 ID>" }],
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

把已有的 `AMEM_SHARED_WIKI_CONFIG` 设为这份文件的绝对路径，在宿主环境私下提供
`TEAM_WIKI_TOKEN`。继续使用 `wiki shared-list`、
`wiki shared-snapshot … --expected-commit …`，或 Agent 工具
`memory_shared_wiki_catalog`、`memory_shared_wiki_snapshot` 和本机管理页面。
云端读取必须提供页面显示的完整版本，省略会被拒绝。配置中的资料库和租户 ID 属于原始来源，
不是服务用于识别账号的资料库。列出来源不会联网，也不证明远端当前可用；明确读取时才请求远端，
并在服务端解密前进一步限制到本机调用者与配置允许的范围。

可选宿主字段包括 `timeoutMs`（100–120000，默认 30000 毫秒）和绝对路径的 `caFile`
（普通 CA 证书文件，最多 1000000 字节）。证书和主机名始终需要验证。
只有明确设置 `allowLoopbackHttp: true` 才允许开发时访问字面地址 `127.0.0.1` 或 `::1` 的
HTTP。地址不能带末尾斜杠、路径、用户名密码、查询或片段。重定向会被拒绝，凭据不会转发；
失败时不会重试或返回缓存。凭据和 CA 摘要不进入读取结果或导入计划。绑定、所选凭据或 CA
改变后，旧的检查结果不能继续使用；远端短期有效期会覆盖后续本机锁等待，确认导入时仍需重新读取。

第 2 版也可使用增加 `"transport":"local"` 的本机来源。第 1 版保留原有本机行为和可选的
版本前置条件。旧程序会拒绝第 2 版，启用前应停止旧进程；不会迁移资料库记录或结构。
服务端拒绝云端和 Git 来源配置，防止账号把服务变成循环转发入口。

## 配置 Git 缓存候选实现

使用同一份第 2 版宿主文件和现有共享读取入口，分别固定远端、分支短名和完整版本：

```json
{
  "version": 2,
  "sources": [{
    "transport": "git",
    "id": "team-git",
    "title": "Team Git Wiki",
    "remote": "ssh://git@git.example.com/team/wiki.git",
    "branch": "published",
    "commit": "<来源完整固定版本>",
    "vaultId": "<来源资料库 ID>",
    "tenantId": "<来源租户 ID>",
    "readers": [{ "id": "local-reader", "tenantId": "<本机客户端租户 ID>" }],
    "scopes": ["project"],
    "maxSensitivity": "internal"
  }]
}
```

通常使用不含凭据的 HTTPS、SSH 或 `git@host:path` 地址。Git 使用操作者本机已有的凭据或
SSH 配置，关闭交互式提示；不要把凭据写进地址。绝对本机路径或 `file:` 地址需要宿主明确设置
`allowLocalFile: true`，并独立确认本机仓库可信。请求不能提供命令、远端路径或分支。
拥有 Git 仓库读取权限，不代表拥有宿主文件中配置的读者权限，两者都需要满足。

列出来源不会访问远端。每次读取都需要 `expectedCommit`，先拉取配置的分支，再确认固定版本仍
属于该分支的完整历史。分支当前的撤回、分类和到期限制继续作用于旧版本。远端不可用、版本被移出
历史、文件不安全或更新失败都会拒绝；不会返回已有缓存。更新固定版本必须修改宿主文件并重新选择
页面显示的版本。读取不执行 Git 推送、合并或检出。

派生缓存固定在读取者资料库的 `.amem/shared-cache/<id>/vault/` 下。所有者文件记录读取者、来源
ID、远端和分支；把同一名称改为另一来源会被拒绝。停止全部读取进程后，操作者可以重置该缓存目录，
或改用新名称；重置前应单独保存私有密钥。不要把缓存当工作目录。成功更新只替换经过验证的受管文件，
保留 `.amem/keys.json` 等私有运行文件。中断后的下一次明确读取会重新拉取，再重建未完成的文件替换。

读取机密页面时，需要单独把来源的包装记录密钥文件配置到缓存的 `.amem/keys.json`，设置私有文件
权限，并用 `masterKeyEnv` 指定相应主密钥的宿主环境变量。Git 远端不能包含密钥文件或主密钥。
密钥缺失或擦除后，即使密文已拉取，也不能重新解密。读取允许的非机密页面时，不会解密无关机密记录。
如果来源擦除了密钥，却没有通知缓存操作者，Git 无法获知；需要每次读取都检查来源当前密钥时，应使用
自托管服务。两种方式都无法收回读者已复制的明文。

`timeoutMs` 为 100–120000 毫秒，默认 30000，覆盖更新和快照读取。`maxCacheBytes` 为
64000–1073741824 字节，默认 536870912；更新前后检查大小，拉取期间持续检查。两次检查之间可能
超过限制，仍需宿主磁盘和进程资源限制。当前文件树最多 5000 个文件，单文件 10 MB、总共 100 MB，
并继续遵守所选页面图的限制。符号链接、子模块、运行目录、Git 属性和有歧义的跨平台路径会被拒绝。
文件按验证过的原始对象字节复制，禁用钩子和转换，不执行来源内容。确认库导入时再次拉取，并保留
独立的读取、写入、审核权限和明确确认要求。

## 限制与剩余工作

服务检查当前来源授权、密钥和撤回状态。已完成的一次读取可能先于同时发生的撤回；已经复制的
明文无法收回。账号摘要不是加密密钥；读取加密来源还需要单独配置其密钥。

开发循环没有配置真实账号、授权、服务或证书，也没有部署、推送或发布 npm。两种传输方式的整批验收、
完整入口及安装包验证仍在 [路线图](remaining-roadmap.md) 中待完成。
