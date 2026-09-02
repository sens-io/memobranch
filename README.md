# Agent Memory Wiki

一个面向 AI Agent 的本地优先长期记忆层：**Markdown 是数据库，LLM 负责提炼，Git 负责归因和回滚，Wiki 链接负责组织与检索。**

项目借鉴了 [OpenKnowledge](https://github.com/inkeep/open-knowledge) 的核心思路，但不是它的代码分支：

- 记忆是普通 Markdown，可直接阅读、编辑、搜索和迁移；
- 每次人类或 Agent 写入都有独立 Git 提交和作者身份；
- 链接与反向链接组成知识图谱，检索会沿一跳关系扩展；
- 原始来源、研究候选、正式知识分层，避免一次对话直接污染长期记忆。

## 记忆生命周期

```text
conversation / tool output / document
                │ capture（幂等）
                ▼
       evidence/  不可变证据
                │ LLM extract 或 agent propose
                ▼
       candidates/  待审核候选
                │ consolidate / approve
                ▼
       wiki/  正式记忆 ── links/backlinks ── 相关记忆
                │
        MEMORY.md + INDEX.md
       少量常驻     完整目录
```

正式记忆不会被直接删除：修订会形成 `supersedes` 链，遗忘会写入 `revoked` 事件并立即停止检索。原始证据仍可审计。若有法规要求的物理删除，应在业务层另加受控的数据销毁流程。

## 快速开始

需要 Node.js 20+ 和 Git。

```bash
npm install
npm run build
npm link

mkdir ~/my-agent-memory
amem init ~/my-agent-memory --name personal-agent
```

捕获一段原始信息：

```bash
amem capture "请记住：默认用中文简洁回答" \
  --root ~/my-agent-memory \
  --actor codex --actor-name Codex
```

由 Agent 明确提出一条候选记忆，再进行整合：

```bash
amem propose "用户偏好简洁的中文回答。" \
  --root ~/my-agent-memory \
  --key "回答语言与风格" \
  --kind preference \
  --scope user \
  --confidence 0.95 \
  --explicit

amem consolidate --root ~/my-agent-memory
amem search "用户喜欢怎样的回答" --root ~/my-agent-memory
amem context "如何回复这个用户" --root ~/my-agent-memory
```

如果候选置信度不够、与正式记忆冲突，或仅凭一次经历试图生成通用流程，它会停留在 `candidates/`。人工确认后可显式批准：

```bash
amem approve cand-xxxxxxxxxxxx --root ~/my-agent-memory \
  --actor reviewer --actor-name "Human Reviewer"
```

撤销一条记忆：

```bash
amem forget mem-xxxxxxxxxxxx --root ~/my-agent-memory \
  --reason "该偏好已被用户撤回"
```

## LLM 提炼与问答

基础的写入、审核、检索和 Git 历史不依赖模型。需要自动提炼或基于记忆生成答案时，配置任意兼容 OpenAI Chat Completions 的服务：

```bash
export AMEM_LLM_API_KEY="..."
export AMEM_LLM_MODEL="gpt-4.1-mini"
export AMEM_LLM_BASE_URL="https://api.openai.com/v1"

amem capture "请记住：默认用中文简洁回答" --extract --root ~/my-agent-memory
amem consolidate --root ~/my-agent-memory
amem ask "我应该如何回复？" --root ~/my-agent-memory
```

`capture --extract` 先提交不可变证据，再调用 LLM。即使模型调用失败，原始证据也不会丢失。

## MCP：让 Agent 原生调用

构建后，把下面配置加入支持 MCP 的客户端。将路径替换为实际位置：

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": [
        "/absolute/path/to/agent-memory-wiki/dist/mcp.js",
        "/absolute/path/to/your-memory-vault"
      ]
    }
  }
}
```

提供的工具：

| 工具 | 用途 |
| --- | --- |
| `memory_capture` | 幂等保存原始证据，可选 LLM 提炼 |
| `memory_propose` | 写入原子候选，不直接成为事实 |
| `memory_consolidate` | 合并重复、晋升合格项、暴露冲突 |
| `memory_review` | 显式批准或拒绝候选 |
| `memory_search` | 权限过滤后的 Wiki 检索与一跳扩展 |
| `memory_context` | 拼装常驻记忆与当前问题相关的长尾记忆 |
| `memory_get` | 按 ID 读取正文和来源链 |
| `memory_forget` | 撤销正式记忆，保留审计历史 |
| `memory_doctor` | 检查冲突、过期、死链和孤儿页 |
| `memory_history` | 查看 Git 作者、时间和变更说明 |

推荐 Agent 在可能依赖长期上下文的问题前调用 `memory_context`，在对话结束或出现明确偏好/决定时调用 `memory_capture` 或 `memory_propose`。

## Git 设计

每个记忆库使用一个 shadow repository：Git 元数据位于 `<vault>/.amem/git`，工作树仍是记忆库本身。这样记忆历史不会与宿主代码仓库的提交混在一起，同时 Markdown 文件仍能被 Obsidian、VS Code 或任何文本工具直接打开。

写入只会暂存这些受控路径：

- `evidence/`
- `candidates/`
- `wiki/`
- `MEMORY.md`、`INDEX.md`、`log.md`
- `agent-memory.json`、`AGENTS.md`

相同证据和相同候选使用内容哈希生成稳定 ID，因此 Agent 重试不会重复制造提交。

## 安全与治理

- `scope`：`user`、`project`、`team`、`public`；不同租户应使用不同 vault，不要只依赖标签隔离。
- `sensitivity`：`public`、`internal`、`sensitive`、`secret`。检索默认排除后两者，`MEMORY.md` 永远不写入后两者。
- 原始证据不可变；候选不是事实；正式记忆包含来源、置信度、条件、验证时间和失效时间。
- 同一 `scope + kind + key` 的不同陈述会进入冲突状态，不会静默覆盖。
- `procedure` 默认至少需要两条证据；人工 `approve` 是明确的审核越权点并会留 Git 记录。

## 开发

```bash
npm run check
```

代码使用 MIT License。OpenKnowledge 是 GPL-3.0 项目；本项目只参考其公开架构思想并独立实现，没有复制其源码。
