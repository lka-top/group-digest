# 群聊助手（Group Chat Summary Agent）

一个群聊总结 Agent Web 应用：采集社交平台群聊消息，自动做 **AI 结构化总结**，
并提供群聊过滤、优先级规则、定时总结推送、数据看板等能力。

当前主攻 **QQ**，通过 OneBot 11 协议接入 NapCat / LLOneBot，完成
「消息采集 → 即时提醒 → AI 总结 → 通知推送」全链路。

> 架构细节见 [DESIGN.md](./DESIGN.md)

## 核心功能

| 功能 | 说明 |
|---|---|
| 群消息读取 | 多平台可插拔适配器；消息自动清洗、CQ 码解析、去重入库 |
| AI 自动总结 | 按群 + 时间窗生成结构化 Markdown 总结；超长消息自动 map-reduce 分段汇总 |
| 群聊过滤 | 按群开关，禁用后不再读取该群消息 |
| 优先级规则 | 关键词 / 发送者 / 正则匹配，命中后触发**即时提醒**（带冷却与限流） |
| 定时总结推送 | node-cron 定时生成并按通道推送（站内控制台 + 邮件） |
| 数据看板 | 平台/账号/群聊树、在线账号、消息量、总结数、未读通知统计 |
| 实时更新 | 全局 SSE 推送新消息 / 新总结 / 即时提醒 |

保留模板的 **Agent 对话**能力（多会话、流式响应、工具调用可视化、权限控制、自定义 Agent）。

## 技术栈

- **后端**：Node.js + Express 4 + TypeScript（tsx 运行，ESM）+ better-sqlite3
- **前端**：React 18 + Vite 5 + TypeScript + TDesign React + Tailwind CSS
- **AI**：CodeBuddy Agent SDK / OpenAI Chat Completions 兼容接口 / Ollama
- **消息源**：OneBot 11（NapCat、LLOneBot 兼容）
- **调度**：node-cron ｜ **邮件**：nodemailer

## 快速开始

### 1. 安装依赖

```bash
npm install
```

> 项目已内置 `.npmrc`，默认走 **国内镜像**（`registry.npmmirror.com`）并放宽 peer 依赖，无需额外加参数。
> 若镜像不可用，可切换到「本地代理 + 官方源」：编辑 `.npmrc`，注释掉 `registry=...npmmirror.com`，
> 取消 `proxy` / `https-proxy` 两行注释（默认 `http://127.0.0.1:7897`，按需修改）。

### 2. 配置环境变量

```bash
cp .env.example .env
```

最少只需关注：

- `ADAPTER=onebot11`—— 通过 NapCat / LLOneBot 接入已授权的 QQ 群
- AI 可直接在应用「设置 → 平台接入」中选择 CodeBuddy、OpenAI 兼容接口或 Ollama

### 3. 启动

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:3000

## 接入真实 QQ（OneBot 11 / NapCat）

> ⚠️ **风险提示**：NapCat / LLOneBot 属第三方 QQ 协议实现，接入个人 QQ 号可能违反腾讯服务条款，
> 存在**账号风控 / 封号风险**。请使用专用小号，控制频率，并仅接入你有权管理的群。
> 群聊消息含个人信息，请遵循《个人信息保护法》，做到最小化存储与知情同意。

### 推荐：使用仓库自带的 Docker Compose

```bash
cd deploy/napcat
cp .env.example .env
# 编辑 .env，至少把 WEBUI_TOKEN 换成随机强密钥
NAPCAT_UID=$(id -u) NAPCAT_GID=$(id -g) docker compose up -d
```

然后访问 http://127.0.0.1:6099/webui ，使用 `.env` 中的 `WEBUI_TOKEN` 登录并按页面提示扫码。
当前 NapCat 镜像不一定会在启动日志中打印密钥，因此不要把日志作为唯一获取方式。对于已经运行并生成过配置的实例，
可以在本机执行 `jq -r '.token' data/config/webui.json` 读取当前 WebUI 密钥；请勿把输出提交到 Git、聊天或截图中。
若未设置 `WEBUI_TOKEN`，本 Compose 的兼容默认值为 `napcat`，仅适合首次本机登录，登录后应立即更换。
首次扫码成功后，可在 `deploy/napcat/.env` 写入 `NAPCAT_ACCOUNT=你的QQ号`，之后容器重启会尝试快速登录。

> `WEBUI_TOKEN` 只用于登录 NapCat 管理页；下方 OneBot `Token` 用于 NapCat 与本应用之间的连接鉴权，二者不要混用。

在 NapCat「网络配置」中新增并启用 **WebSocket 客户端**：

- URL：`ws://host.docker.internal:3001/onebot/v11/ws`
- Token：与本应用设置页生成、保存的 OneBot Token 完全一致
- 上报自身消息：建议开启（否则当前登录 QQ 自己发送的消息不会进入总结系统）

需要同时接入多个 QQ 账号时，为每个账号分别运行一个 NapCat 实例，并让它们使用相同的 URL 和 OneBot Token
连接本应用。应用允许多个客户端同时连入同一反向 WS 端口，会根据 OneBot 事件中的 `self_id` 自动区分账号，
独立同步群、采集消息和执行历史回填。可在“群聊管理”的平台 → 账号 → 群聊树中查看各连接状态。

最后在本应用「设置 → 平台接入」中将消息来源切换为「真实 QQ」，保存并重启 `npm run dev`。

### 手动部署 NapCat / LLOneBot

1. 部署并扫码登录一个或多个专用 QQ 小号（每个同时在线的账号对应一个 NapCat 实例）
2. 可在设置页完成配置；也可以修改 `.env`：

   ```bash
   ADAPTER=onebot11
   ONEBOT_MODE=reverse-ws
   ONEBOT_WS_PORT=3001
   ONEBOT_WS_PATH=/onebot/v11/ws
   ONEBOT_TOKEN=your-token        # 与 NapCat 配置一致
   ```

3. 重启后端 `npm run server`，日志会输出监听地址
4. 在每个 NapCat「网络配置」中新增 **WebSocket 客户端**：
   - URL：`ws://<本机IP>:3001/onebot/v11/ws`
   - Token：与 `ONEBOT_TOKEN` 相同
5. 回到应用「群聊管理」点击「从平台同步群」，会一次同步所有在线账号的群

### 授权监控、历史回填与总结范围

- 真实群首次同步后默认不处理；选择任一读取模式后才会记录授权时间并开始持续监控。平台或账号下发过默认策略后，新同步的群会继承该策略。
- 实时事件早于最近一次授权时间时不会入库；停止后重新开启会建立新的授权起点。
- 授权前历史不会被后台计划擅自读取。可以在对应群卡片中确认后回填最近 N 条，消息会标记为“历史回填”。
- 手动总结支持“滚动时间窗”和“自定义起止时间”。滚动时间窗默认开启“允许回填授权前消息”，会回填完整的最近范围；用户关闭许可后才从授权时间截断。自定义起点早于授权时间时，点击生成也代表对本次范围明确授权。系统会先自动分页回填到所选起点，并在输出区显示进度。
- 自动总结使用每次执行时向前回溯的滚动时间窗，并始终把实际起点限制在最近一次授权时间之后。
- 应用进程和 NapCat 必须保持运行，才能持续接收实时消息。

> 当前仅实现 **反向 WS 服务端** 模式；正向 WS / HTTP 模式为后续阶段。

## 项目结构

```
group-chat-summary/
├── server/                       # 后端
│   ├── index.ts                  # Express 入口（模板 + 群聊域路由挂载）
│   ├── db.ts                     # SQLite 建表与数据访问
│   ├── config.ts                 # 集中配置
│   ├── eventBus.ts               # 进程内事件总线（驱动 SSE）
│   ├── scheduler.ts              # node-cron 定时总结
│   ├── adapters/                 # 平台适配器（types / onebot11 / index）
│   ├── ingest/                   # CQ 码解析 + 入库管道 + 历史分页回填
│   ├── summary/                  # 提示词 + 总结引擎
│   ├── notify/                   # 站内通知分发 + 邮件
│   └── routes/                   # groups / messages / summaries / notifications
│                                 # priorities / schedules / settings / events / dashboard
├── src/                          # 前端
│   ├── App.tsx                   # 路由与主布局
│   ├── api.ts                    # 请求封装
│   ├── components/               # Sidebar / Header / SettingsPage / PlatformSettings
│   ├── pages/                    # GroupsPage / MessagesPage / SummaryPage
│   │                             # NotificationsPage / SchedulesPage / PrioritiesPage
│   └── hooks/                    # useGroups / useMessages / useSummaries / useEvents ...
├── data/chat.db                  # SQLite 数据库（自动创建）
├── DESIGN.md                     # 架构设计文档
└── .env.example                  # 环境变量样例
```

## 常用命令

```bash
npm run dev          # 同时启动前后端（前端 5173 / 后端 3000）
npm run dev:server   # 仅后端
npm run dev:client   # 仅前端
npm run napcat:token # 单独显示本机 NapCat WebUI 地址与登录 Token
npm run typecheck    # 前后端 TypeScript 类型检查
npm run build        # 生产构建
```

执行 `npm run dev` 或 `npm run server` 时，启动前也会自动在当前终端显示 NapCat WebUI Token。
该信息属于本机管理凭据，请勿将终端输出上传或分享。

## 常见问题

**Q：总结一直失败/提示未配置 AI？**
A：进入「设置 → 平台接入」选择一种总结提供方。OpenAI 兼容模式需填写接口基地址（通常以 `/v1` 结尾）、模型名和 API Key；
Ollama 默认使用 `http://127.0.0.1:11434/v1`，只需确保对应模型已在本机安装；CodeBuddy 则使用 `.env` 凭据或 CLI 登录。

**Q：`npm install` 很慢 / 卡住 / 报 ERESOLVE / 磁盘空间不足？**
A：
- **慢**：默认走 `.npmrc` 中的国内镜像；若仍慢，改用本地代理（见「安装依赖」说明）。切勿用 `/tmp` 作为 npm 缓存目录（部分环境 `/tmp` 是仅 10MB 的 tmpfs，会触发 ENOSPC 并产生损坏缓存）。
- **卡住**：不要同时运行多个 `npm install`（并发写同一个 `node_modules` 会导致解压死循环）。
- **ERESOLVE**：`.npmrc` 已开启 `legacy-peer-deps`，一般不会出现。
- **缓存损坏**：`npm cache verify`，或换一个全新的 `--cache` 目录重装。

**Q：NapCat 显示在线但收不到消息？**
A：依次检查：反向 WS URL 是否正确、Token 是否一致、NapCat 中该连接是否启用、`ADAPTER` 是否已设为 `onebot11` 并重启。

## License

MIT
