# Agent Memory Wiki

面向 AI Agent 的生产级、本地优先长期记忆层：Markdown 是权威数据，Git 负责归因、版本和跨机器同步，LLM 只承担可选的提炼、向量化与问答。

本项目借鉴 [OpenKnowledge](https://github.com/inkeep/open-knowledge) 的 Git 与 LLM Wiki 思路并独立实现，不包含其源码。生产版采用 OpenSpec 的 proposal → specs → design → tasks → implementation → verification 流程开发。

## 能力与边界

- `evidence/` 保存不可变证据，`candidates/` 是审核队列，`wiki/` 是正式记忆。
- 每个逻辑写入先写事务日志，再原子替换文件，最后创建带身份归因的 Git 提交；崩溃后可回滚或重放。
- 服务端主体拥有固定权限、作用域和最高敏感级别；MCP 调用者不能自行声明身份或权限。
- `sensitive`、`secret` 的完整元数据和正文使用每记录数据密钥进行 AES-256-GCM 信封加密。
- 非机密 Wiki 使用持久化增量索引；英文与 CJK 词法检索无需模型，可选 OpenAI 兼容 embeddings 混合排序。
- shadow Git 仓库支持远端状态、快进、常规合并、冲突中止、健康校验和受控推送。
- 提供一次性维护、文件变更防抖、单实例守护进程、`/healthz` 和 Prometheus `/metrics`。

该版本仍是“一租户一个 vault”的本地服务，不提供浏览器编辑器、托管控制面、多租户数据库、分布式并发写入或自动语义冲突裁决。

## 运行要求与安装

- Node.js 20 或更新版本
- 可从 `PATH` 调用的 Git

```bash
npm ci
npm run build
npm link

amem init ~/my-agent-memory --name personal-agent --json
amem doctor --root ~/my-agent-memory --json
```

运行时数据布局：

```text
vault/
├── agent-memory.json       # v2 配置
├── AGENTS.md               # Agent 使用约束
├── evidence/               # 不可变原始证据
├── candidates/             # 待审核候选
├── wiki/                   # 正式记忆
├── MEMORY.md               # 非机密常驻卡片（自动生成）
├── INDEX.md                # 非机密目录（自动生成）
├── log.md                  # 不含正文的 Git 审计摘要
└── .amem/
    ├── git/                # shadow Git 元数据
    ├── keys.json           # 本地 wrapped data keys，不进入 Git
    ├── transactions/       # 写前事务日志
    ├── search-index.json   # 可重建词法索引，不进入 Git
    ├── embeddings.json     # 可重建向量缓存，不进入 Git
    ├── audit.jsonl         # 结构化、脱敏运行审计
    └── metrics.json        # 有界计数器和仪表
```

## 基本流程

```bash
# 捕获证据；相同输入使用稳定哈希去重
amem capture "请记住：默认用中文简洁回答" \
  --root ~/my-agent-memory --scope user --sensitivity internal --json

# 写入候选，并按策略整合
amem propose "用户偏好简洁的中文回答。" \
  --root ~/my-agent-memory \
  --key "回答语言与风格" --kind preference --scope user \
  --confidence 0.95 --explicit --json
amem consolidate --root ~/my-agent-memory --json

# 返回 hits、semanticStatus 和 indexRebuilt
amem search "用户喜欢怎样的回答" --root ~/my-agent-memory --json
amem context "如何回复这个用户" --root ~/my-agent-memory

# 冲突或低置信候选由审核者显式处理
amem approve cand-xxxxxxxxxxxx --root ~/my-agent-memory --json
amem reject cand-xxxxxxxxxxxx --reason "证据不足" --root ~/my-agent-memory --json

# 撤销保留可审计密文历史；erase 另行销毁本地数据密钥
amem forget mem-xxxxxxxxxxxx --reason "偏好已撤回" --root ~/my-agent-memory --json
amem erase mem-xxxxxxxxxxxx --reason "已确认执行密码学擦除" --root ~/my-agent-memory --json
```

`procedure` 默认至少需要两份证据；同一 `scope + kind + key` 的不同内容进入显式冲突，系统不会静默覆盖。`forget` 是可审计撤销，`erase` 是管理员操作，仅适用于已加密记录。

## 机密记录与密钥托管

首次写入或读取 `sensitive` / `secret` 记录前，提供一个 32 字节 master key（64 个十六进制字符，或解码后正好 32 字节的 Base64）：

```bash
export AMEM_MASTER_KEY="$(openssl rand -hex 32)"
amem capture "机密内容" --root ~/my-agent-memory --sensitivity secret --json
```

生产注意事项：

- 通过操作系统密钥链、secret manager 或进程注入提供 `AMEM_MASTER_KEY`，不要写进 shell 历史、配置、远端 URL 或仓库。
- `.amem/keys.json` 只包含由 master key 包装的数据密钥，但它仍是恢复机密记录所必需的本地状态。需要跨主机读取时，应通过受控的加密备份独立迁移它；Git 远端不会同步它。
- 同时备份 master key 与 `.amem/keys.json`，并分离访问控制。丢失任意一项都会使相关历史密文不可恢复。
- `erase` 删除目标记录的 wrapped data key，并写入不敏感墓碑。它不能声称删除了不受本机控制的日志、已导出的明文、远端备份或第三方模型数据。
- 机密记录不会进入 `MEMORY.md`、`INDEX.md`、持久化搜索索引、向量服务、运行审计正文或指标标签；授权查询仅在内存中临时解密并做词法匹配。

## 权限与环境变量

CLI 在未配置策略环境变量时以本机操作员身份运行；一旦设置策略变量，CLI 与 MCP 都执行相同的权限检查。MCP 始终从服务器环境构造不可变主体。

| 变量 | 含义 | 默认值 |
| --- | --- | --- |
| `AMEM_VAULT` | MCP vault 路径 | 当前目录 |
| `AMEM_ACTOR_ID` / `AMEM_ACTOR_NAME` / `AMEM_ACTOR_EMAIL` | Git 与审计身份 | `agent` / ID / 空 |
| `AMEM_PERMISSIONS` | `read,write,review,sync,maintain,admin` 子集 | MCP 为 `read` |
| `AMEM_ALLOWED_SCOPES` | `user,project,team,public` 子集 | 全部 |
| `AMEM_MAX_SENSITIVITY` | `public`、`internal`、`sensitive`、`secret` | `internal` |
| `AMEM_TENANT_ID` | 可选的 vault 租户绑定 | 空 |
| `AMEM_MASTER_KEY` | 信封加密 master key | 空，机密操作失败关闭 |
| `AMEM_LLM_API_KEY` / `OPENAI_API_KEY` | OpenAI 兼容 API 凭据 | 空 |
| `AMEM_LLM_MODEL` | 提炼与问答模型 | `gpt-4.1-mini` |
| `AMEM_LLM_BASE_URL` | OpenAI 兼容 API 根地址 | `https://api.openai.com/v1` |
| `AMEM_EMBEDDING_MODEL` | 可选向量模型 | 空，使用词法检索 |

权限用途：`read` 检索和读取，`write` 捕获/提议，`review` 整合/批准/拒绝/撤销，`sync` 远端操作，`maintain` 恢复/索引/健康/守护进程，`admin` 包含所有权限并允许密码学擦除。

查看有效的非秘密配置和主体：

```bash
amem config --root ~/my-agent-memory --json
amem policy --root ~/my-agent-memory --json
amem version --json
```

## LLM 与混合检索

基础写入、审核、Git、恢复和 CJK/英文检索不需要模型。配置 Chat Completions 后可自动提炼和基于记忆问答：

```bash
export AMEM_LLM_API_KEY="..."
export AMEM_LLM_MODEL="gpt-4.1-mini"
export AMEM_LLM_BASE_URL="https://api.openai.com/v1"

amem capture "请记住：默认用中文简洁回答" --extract --root ~/my-agent-memory --json
amem ask "我应该如何回复？" --root ~/my-agent-memory --json
```

在 `agent-memory.json` 的 `index.embeddingModel` 中配置模型后，可执行 `amem reindex --semantic` 或 `amem search --semantic`。向量提供方不可用时请求仍返回词法结果，并报告 `semanticStatus: "degraded"`。只有非机密正式 Wiki 页面会发送到 embedding API。

## 远端 Git 同步

远端认证完全交给 Git credential helper 或 SSH agent。CLI/MCP 不接受 token 参数；带 URL userinfo 的地址会被拒绝。

```bash
amem remote set git@github.com:org/memory-vault.git \
  --root ~/my-agent-memory --name origin --branch main --json
amem remote status --root ~/my-agent-memory --json
amem remote sync --root ~/my-agent-memory --push --json
```

同步流程会先恢复本地事务并要求受控工作树干净，然后 fetch、计算 ahead/behind、快进或常规 merge、重建派生文件、运行健康校验，最后才按配置推送。冲突会列出路径并执行 `git merge --abort`，保留同步前的本地状态。远端状态包含 `head`、`upstream`、`ahead`、`behind`、`diverged`、`conflicts` 和 `lastSuccessfulSync`。

## 维护与守护进程

```bash
# 一次性：恢复、到期处理、增量索引、doctor、可选自动同步
amem maintenance --root ~/my-agent-memory --json

# 单实例长期运行；只允许回环地址
amem serve --root ~/my-agent-memory --host 127.0.0.1 --port 9464
curl http://127.0.0.1:9464/healthz
curl http://127.0.0.1:9464/metrics
```

建议用 systemd、launchd 或容器编排器管理 `amem serve`，注入环境变量并发送 `SIGTERM` 做优雅关闭。服务租约保存在 `.amem/service.json`；存活 PID 不会被第二实例抢占。文件监听仅作为变化提示，实际更新仍由内容哈希决定。

## MCP 配置

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": [
        "/absolute/path/to/agent-memory-wiki/dist/mcp.js",
        "/absolute/path/to/memory-vault"
      ],
      "env": {
        "AMEM_ACTOR_ID": "workspace-agent",
        "AMEM_ACTOR_NAME": "Workspace Agent",
        "AMEM_PERMISSIONS": "read,write,review",
        "AMEM_ALLOWED_SCOPES": "user,project",
        "AMEM_MAX_SENSITIVITY": "internal"
      }
    }
  }
}
```

工具包括：`memory_capture`、`memory_propose`、`memory_search`、`memory_context`、`memory_get`、`memory_consolidate`、`memory_review`、`memory_forget`、`memory_erase`、`memory_doctor`、`memory_history`、`memory_recover`、`memory_reindex`、`memory_remote_status`、`memory_remote_sync`、`memory_maintenance`、`memory_version`、`memory_config`、`memory_policy`。

所有 MCP 错误都以 `isError: true` 返回稳定错误码，不输出堆栈或秘密，且不会终止服务器。建议 Agent 在可能依赖长期上下文的问题前调用 `memory_context`。

## v1 → v2 迁移

v1 vault 在第一次受控写入时自动执行迁移，也可以先显式执行：

```bash
amem config migrate --root ~/my-agent-memory --json
```

迁移会先保留 `agent-memory.json.v1.bak`，继承原有常驻预算、置信度和流程证据阈值，再加入租户、权限、索引、远端、维护和限制配置。已有 `sensitive` / `secret` 明文文档只有在显式迁移且提供 `AMEM_MASTER_KEY` 时才会重写为加密信封。未来版本配置允许 `doctor` 只读诊断，但拒绝所有写入。

回滚前先停止服务，确认没有 `.amem/transactions/*.json`，保存 v2 Git 提交和 `.amem` 加密备份，再恢复迁移前提交及 `agent-memory.json.v1.bak`。不要让 v1 软件写入已经迁移的 vault。

## 恢复手册

1. 停止所有写入者和守护进程，保留整个 vault 与 `.amem/` 的副本。
2. 执行 `amem doctor --json`，记录配置、Git、索引和待恢复事务状态。
3. 执行 `amem recover --json`：`writing` 事务恢复原文件，`ready` 事务重放完整目标并提交。
4. 执行 `amem reindex --json`；索引缺失、损坏或版本不兼容会从 Markdown 重建。
5. 执行 `amem remote status --json`。出现 divergence 时先人工检查；不要绕过冲突保护强推。
6. 再次执行 `amem doctor --json`。仅在 `healthy: true` 后恢复自动同步和服务流量。

如果 Git 对象损坏，`doctor` 会标记不健康并禁止安全同步。应从可信远端或备份恢复 `.amem/git`，不要删除工作树中的 Markdown 权威数据。若 master key 或 wrapped key 丢失，系统会失败关闭；请从受控密钥备份恢复，不要重新生成同名 key 冒充原密钥。

## 威胁模型

本实现防护：不可信 MCP 调用者伪造身份、越权作用域/敏感度读取、机密明文落入 Git/索引/日志/指标、部分写入、重复执行、远端 URL 凭据落盘、常见同步冲突和模型服务不可用。

本实现不防护：已完全控制本机或进程内存的攻击者、恶意本机管理员、已导出的明文、操作系统/备份系统泄漏、Git 或 LLM 供应链被攻陷、流量分析，以及远端和第三方已持有副本的删除。生产部署仍需磁盘加密、最小文件权限、进程隔离、密钥轮换、受控备份和供应链扫描。

## 开发与发布门禁

```bash
npm run check
npm pack --dry-run
npm audit --omit=dev
OPENSPEC_TELEMETRY=0 openspec validate production-hardening --strict
```

测试覆盖 CLI/MCP 契约、权限拒绝、信封加密与擦除、事务回滚/重放、活锁/陈旧锁、索引损坏与 CJK、代表性规模性能、裸远端推拉/分叉/冲突，以及维护服务端点和优雅关闭。

代码使用 MIT License。OpenKnowledge 使用 GPL-3.0；本项目仅参考公开架构思想。
