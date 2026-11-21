# web-disk-managerment

Total Commander 风格的双栏 Web 文件管理器，通过 **OpenList** 统一管理腾讯云 COS / 阿里云 OSS 以及百度网盘、夸克、115 等国内网盘。

- 双栏（左 / 右）独立浏览，可分别在两栏下拉选择不同「存储」（网盘或 COS/OSS 挂载点）
- 跨栏文件/文件夹操作：**复制**、**移动**、**重命名**、**删除**、**新建目录**、**新建文件**、**上传**（也支持拖拽上传）
- 快捷键：`F2` 重命名 · `F3` 刷新 · `F5` 复制到对侧 · `F6` 移动到对侧 · `F7` 新建目录 · `F8` 删除 · `Backspace` 上级 · `Enter` 打开 · `Tab` 切换面板
- 后端仅做 OpenList API 的代理（避免 CORS、隐藏令牌），前端为 React + Redux Toolkit

## 架构

```
浏览器 (React 双栏 UI)
      │  /api/*（Vite 开发代理 / Express 生产托管）
      ▼
Express 代理 (server/index.mjs)
      │  OpenList REST API（带 Authorization 令牌）
      ▼
OpenList  ──挂载──► 腾讯COS / 阿里OSS / 百度网盘 / 夸克 / 115 ...
```

## Docker 一键启动（推荐）

项目已经内置 `docker-compose.yml`，会同时启动：

- `openlist`：真正连接 COS / R2 / 115 / 百度 / 夸克的网盘聚合服务
- `web-disk`：本项目的双栏文件管理界面

启动：

```bash
cp .env.example .env
docker compose up -d --build
```

访问：

- Web Disk Manager：http://localhost:3001
- OpenList 后台：http://localhost:5244

第一次启动后，获取 OpenList 管理员密码：

```bash
docker exec -it web-disk-openlist ./openlist admin random
```

用输出的密码登录 `http://localhost:5244`。登录后在 OpenList 后台生成管理员 token，并写入 `.env`：

```env
OPENLIST_TOKEN=这里填OpenList管理员token
```

然后重启 Web 管理器，让它读取 token：

```bash
docker compose up -d --force-recreate web-disk
```

现在回到 http://localhost:3001，点击顶部 **挂载 COS / R2 / 网盘**：

- COS：填 endpoint、SecretId、SecretKey、Bucket、region
- R2：填 endpoint、Access Key ID、Secret Access Key、Bucket、region 可用 `auto`
- 115 / 百度 / 夸克：走 OpenList 对应驱动的扫码/授权字段

## 配置

复制 `.env.example` 为 `.env` 并填写：

```bash
cp .env.example .env
```

```env
OPENLIST_URL=http://127.0.0.1:5244
OPENLIST_TOKEN=            # OpenList 后台「设置 -> 其他 -> 令牌」生成
PORT=3001
```

如果使用 Docker Compose，容器内会自动使用 `OPENLIST_URL=http://openlist:5244`，你只需要在 `.env` 里补 `OPENLIST_TOKEN`。

## 开发

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173
- 后端代理：http://127.0.0.1:3001

## 生产构建与启动

```bash
npm run build   # 构建前端到 dist/
npm start       # Express 同时提供 /api 代理与 dist 静态资源
```

访问 http://127.0.0.1:3001 即可。

## 说明

- 跨网盘传输由 OpenList 处理：S3 系（COS/OSS 之间）可走云端直传；涉及百度 / 夸克 / 115 时通常需经 OpenList 所在服务器中转，速度受服务器带宽与网盘限速影响。
- `新建文件` 通过写入空内容实现；`上传` 为流式（内存）转发到 OpenList。
