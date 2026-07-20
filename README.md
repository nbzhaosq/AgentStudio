# Agent Studio

多个本机 CLI Agent（Claude Code、Codex、Kimi，以及任意可配置 CLI）在同一个"聊天室"里协作：互相 @、讨论，并在共享的项目目录里一起干活。

## 工作原理

- Web 聊天室：用户和多个 agent 共处一室，谁被 @ 谁发言；agent 回复里再 @ 别人则形成接力。
- 每个 agent 通过本机已安装的 CLI 的非交互模式调用（`claude -p`、`codex exec`、`kimi -p`），复用各 CLI 的登录态，不需要额外 API key。
- 每个房间绑定一个项目目录，agent 在该目录内读写文件，共同完成项目。
- 防死循环：一条用户消息引发的 @ 接力最多 12 跳，超限自动停止。

## 快速开始

```bash
pnpm install
pnpm --filter @agent-studio/web build   # 构建前端（只需一次）
pnpm dev                                 # 启动 server: http://localhost:8787
```

开发模式（前端热更新）：

```bash
pnpm dev        # 终端 1：server :8787
pnpm dev:web    # 终端 2：vite dev :5173（已配置代理）
```

打开浏览器后：点「+ 房间」→ 填房间名称、**项目目录绝对路径**、勾选参与的 agents → 在输入框用 `@` 呼叫它们。

内置了两个 mock agent（`mock-a` / `mock-b`），不调用任何模型，可用来零成本体验：`@mock-a 请 relay 一下`。

## 配置 agents

编辑仓库根目录的 `agents.config.json`：

```jsonc
{
  "id": "sea-code",            // @ 时用的 id
  "name": "Sea Code",
  "color": "#0ea5e9",
  "cmd": "sea-code",           // 可执行命令
  "args": ["run", "{prompt}"], // 参数模板
  "instructions": "前端与 UI 专家" // 可选：角色/专长设定
}
```

### instructions：给 agent 分配专长

`instructions` 会注入该 agent 每轮的 prompt（作为角色设定），同时展示在名册里让其他 agent 知道它擅长什么，@ 分工更有针对性。例如：

- `"前端与 UI 专家，负责 React 组件和样式"`
- `"数据库与 SQL 专家，负责 schema 设计和查询优化"`

### CLI 原生 skills

各 CLI 自己的技能机制直接写进 `args` 即可，例如：

```jsonc
{ "id": "kimi", "args": ["-p", "{prompt}", "--skills-dir", "/path/to/kimi-skills"] }
{ "id": "claude", "args": ["-p", "{prompt}", "--permission-mode", "acceptEdits", "--plugin-dir", "/path/to/plugins"] }
```

### 模型与推理强度（effort）

同样写进 `args`，各 CLI 参数不同（已按当前版本核实）：

```jsonc
{ "id": "claude", "args": ["-p", "{prompt}", "--permission-mode", "acceptEdits",
                            "--model", "opus", "--effort", "high"] }
{ "id": "codex",  "args": ["exec", "{prompt}", "--sandbox", "workspace-write", "--skip-git-repo-check",
                            "-m", "<model>", "-c", "model_reasoning_effort=\"high\"",
                            "-o", "{outfile}"] }
{ "id": "kimi",   "args": ["-p", "{prompt}", "-m", "<model>"] }
```

- claude：`--model`（如 `opus`/`sonnet`）、`--effort <level>`
- codex：`-m/--model`；effort 用 `-c model_reasoning_effort="low|medium|high"`
- kimi：`-m/--model`（模型别名见 kimi 的 `config.toml`）

不设置时各 CLI 用自己的默认模型。

参数模板支持的占位符：

| 占位符 | 含义 |
| --- | --- |
| `{prompt}` | 本轮完整 prompt（作为单个 argv 元素传入） |
| `{outfile}` | 临时文件路径；用到它时，回复从该文件读取（如 `codex -o`） |
| `{cwd}` | 房间绑定的项目目录 |
| `{serverRoot}` | server 代码根目录（定位内置脚本用） |

agent 的最终回复取 `{outfile}` 内容（若使用）或 stdout。

## ⚠️ 安全提示

agent 以自动批准模式运行（claude `acceptEdits`、codex `workspace-write`、kimi `-p` 非交互模式），会在房间目录内**直接修改文件、执行命令**。请：

- 只为房间绑定你信任的项目目录；
- 建议项目先 `git init` 并提交，便于回滚；
- 需要更强/更弱的自治，直接改 `agents.config.json` 里对应 agent 的 `args`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | server 端口 |
| `AGENT_STUDIO_CONFIG` | 仓库根 `agents.config.json` | agent 配置文件路径 |
| `AGENT_STUDIO_DATA_DIR` | `~/.agent-studio` | 房间与消息持久化目录 |
| `AGENT_STUDIO_TIMEOUT_MS` | `600000` | 单次 agent 调用超时 |

## 项目结构

```
agents.config.json    # agent 定义（命令模板）
apps/server/          # Node 后端：房间引擎、CLI 适配、REST + WebSocket
apps/web/             # React + Vite + Tailwind 前端
packages/shared/      # 前后端共享类型与 @ 解析
```

## 测试

```bash
pnpm test        # vitest：@ 解析、路由、接力、防环
pnpm typecheck
pnpm -r build
```

## 当前限制（v1）

- 无状态逐轮调用：每轮把最近 30 条消息注入 prompt，不做 CLI 会话续聊；
- 只看完整回复，不做逐字 streaming；
- 单用户、无账号体系。
