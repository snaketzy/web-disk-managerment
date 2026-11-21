# web-disk-managerment — 项目上下文（跨电脑共享）

> 本文件由本机 Trae 的 18 条历史会话记忆与项目记忆（`project_memory.md`、`topics.md`）汇总而成，
> 目的是在多台电脑上保持一致的 AI 上下文。Trae 会自动加载仓库根目录的 `AGENTS.md`；
> 若使用其它 AI 工具，也可直接读取本文件。内容与 `.trae/rules/project_rules.md` 保持一致，维护其一即可。

## 项目概述

- Total Commander 风格的双栏 Web 文件管理器，通过 **OpenList** 统一管理腾讯云 COS / Cloudflare R2 / 阿里云 OSS 以及百度网盘、夸克、115 等国内网盘。
- 前端：React + Redux Toolkit（RTK）+ Vite；后端：Express 代理（`server/index.mjs`），仅做 OpenList API 代理（避免 CORS、隐藏令牌）。
- 核心交互：左右双栏独立浏览，跨栏 **复制 / 移动 / 重命名 / 删除 / 新建目录 / 新建文件 / 上传（含拖拽）**。

## 硬性约束（Hard Constraints）

- 必须在 `.env` 中配置 `OPENLIST_TOKEN` 才能访问挂载管理 API。
- 后端 Express 代理是前端与 OpenList 通信的唯一入口。
- 远程部署环境：Vultr VPS (45.32.56.92)，使用宝塔面板管理；另有一台阿里云 VPS (139.196.121.33) 用于 OpenList 8080 入口与上传测速。
- 域名配置：`wdm.laybackzzz.com` → 本系统 (3001)；`openlist.laybackzzz.com` → OpenList (5244)。
- SSL 约束：源站仅开放 80 端口，Cloudflare 必须设置为 "Flexible" 模式。
- **123 云盘上传约束**：禁止使用海外节点进行 123 云盘的大文件中转上传。
- **123 云盘 API 限制**：开放平台 API 对新文件上传有 10GB 上限；若 MD5 命中实现秒传，则不受此限制。
- **秒传功能约束**：前端 `Panel.tsx` 仅在对侧驱动为 `123 Open` 时启用秒传按钮；对侧为 115 Cloud 等其它驱动时禁用并提示原因。
- **腾讯云 COS 挂载约束**：Endpoint 必须使用 API 域名而非 Website 域名；`force_path_style` 必须设为 `false`。

## 技术规范（Guidelines）

- 架构：React + RTK + Express，Vite 构建。
- OpenList (v4.2.10) 通过 systemd 托管；Web 管理器通过 pm2 托管。
- Nginx 配置需包含 WebSocket 升级支持、`client_max_body_size 2048m` 及 3600s 长超时。
- 115 扫码登录：使用串行长轮询，必须绕过前端缓存以获取最新二维码。
- 123 云盘上传：遵循官方开放平台链路；分片大小逻辑 `<128MB` 用 16MB/片，`≥128MB` 用 32MB/片。
- 错误处理规范：前端应优先透出后端返回的具体错误原因，避免使用模糊的兜底文案。

## 经验教训（Lessons Learned）

- 因 Mac 性能不足，已彻底卸载本地 Docker 环境，转向 VPS 部署架构。
- **123 云盘秒传逻辑**：秒传通过直接操作 123 平台绕过了 OpenList 写入流，因此必须在成功后主动调用 OpenList 的 `/api/fs/list` 并带 `refresh: true` 刷新目录缓存，否则前端会显示目录为空。
- 秒传失败原因：目标目录已存在同名文件 (502)；123 云盘侧无该 MD5 副本且文件超过 10GB 限制 (409/502)。
- **123 云盘性能结论**：阿里云国内节点远优于本机家宽及海外 VPS；增加并发对提升速度作用有限。
- **COS 目录为空问题**：通常由错误的 Endpoint 或 `force_path_style` 设置引起；前端 `MountManager.tsx` 默认设置可能存在误导。

## 关键历史决策（来自 18 条会话）

- **架构选型**（11-19）：以 OpenList 为中枢，Express 代理 + React 双栏 UI。
- **Docker 阶段**：曾引入 `Dockerfile` / `docker-compose.yml` / `.dockerignore`；后因 Docker 环境损坏（`bbolt/meta.db` 只读、断言失败）及 Mac 性能问题，放弃本地 Docker，改 VPS 部署。
- **部署落地**：宝塔面板 + Nginx 反向代理；`wdm.laybackzzz.com`(3001)、`openlist.laybackzzz.com`(5244)；解决 Cloudflare DNS 与 Flexible SSL。
- **115 网盘**：实现扫码登录（后端代理二维码获取 + 长轮询）；修复 RTK Query 缓存导致二维码过期、长轮询请求堆积的并发缺陷。
- **百度网盘**：授权参数缺失源于 Cookie 跨域丢失 → 改为前端直接打开 `api.oplist.org`，成功获取 `refresh_token` 并完成挂载。
- **夸克网盘**：`QuarkOpen` 驱动需 `AppID`+`SignKey` 本地签名，而官方授权页仅提供令牌导致校验失败 → 弃用，改用基于 Cookie 的 `Quark` 驱动。
- **新建挂载下拉显示 `[object Object]`**：OpenList 驱动列表 API 返回结构与前端解析不匹配，已修复。
- **OpenList 8080 直连**：阿里云服务器新增 `/etc/nginx/conf.d/01-openlist-8080.conf`，8080 → 5244（含 WebSocket 升级 + 3600s 超时）。
- **123 云盘测速**：新增脚本 `scripts/123pan-upload-speed.mjs`（官方开放平台 API 分片上传：获取 Token → 创建文件 → PUT 分片 → 合并）；结果：阿里云 23–25 MB/s、本机 2–4 MB/s、Vultr 东京起步 4–5 后衰减至 <1 MB/s。
- **多 Agent 协同**：GPT 作主 Agent 负责指挥与审核，DeepSeek 作子 Agent 负责执行；高度耦合任务用单窗口多 Task 共享上下文，相互独立任务用多窗口隔离，由主窗口最终整合审计。
- **COS 目录为空修复**（11-22）：Endpoint 修正为 API 域名 `cos.ap-hongkong.myqcloud.com`，`force_path_style` 改为 `false`，修复后目录正常列出 13 项。
- **123 云盘秒传 UI/缓存优化**（11-22）：`Panel.tsx` 增加驱动类型校验；`server/index.mjs` 秒传成功后主动刷新 OpenList 目录缓存（需重启后端 Node 进程生效）。

## 远端环境速查

| 项目 | 值 |
|---|---|
| Web 管理器 | `wdm.laybackzzz.com`（端口 3001，pm2 托管） |
| OpenList 主站 | `openlist.laybackzzz.com`（端口 5244，systemd 托管） |
| OpenList 直连入口 | 阿里云 `139.196.121.33:8080` → 5244 |
| 主要 VPS | Vultr `45.32.56.92`（宝塔）；阿里云 `139.196.121.33` |
| 环境变量 | `OPENLIST_URL`、`OPENLIST_TOKEN`、`PORT=3001` |
