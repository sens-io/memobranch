# 云端共享：开发候选版本

已确认同时支持自托管服务和 Git 远端共享。当前分支包含**自托管读取服务**和**云端客户端候选实现**。
第 2 版客户端配置及现有读取入口正在验证；Git 远端缓存、服务启动配置命令和整批验收仍待完成。
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

## 启动库接口候选实现

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
服务端拒绝云端来源配置，防止账号把服务变成循环转发入口。`git` 配置仍未实现，目前会被拒绝。

## 限制与剩余工作

服务检查当前来源授权、密钥和撤回状态。已完成的一次读取可能先于同时发生的撤回；已经复制的
明文无法收回。账号摘要不是加密密钥；读取加密来源还需要单独配置其密钥。

开发循环没有配置真实账号、授权、服务或证书，也没有部署、推送或发布 npm。两种传输方式的整批验收、
完整入口及安装包验证仍在 [路线图](remaining-roadmap.md) 中待完成。
