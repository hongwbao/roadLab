# 部署说明

RoadLab 是纯静态前端。生产环境只需提供 `dist/` 中的 HTML、JavaScript 和 CSS，不需要 Node.js 常驻进程、数据库或服务器密钥。Node.js 24 用于构建和测试。

## 本地开发与构建预览

```bash
git clone https://github.com/hongwbao/roadLab.git
cd roadLab
npm ci
npm run dev
```

开发地址为 http://localhost:5173/ 。`npm run dev` 监听局域网网卡，其他设备使用这台机器的 IP。

```bash
npm run check
npm run preview
```

`check` 包含格式、类型、构建和核心测试。预览地址为 http://localhost:4173/ 。`vite preview` 用于检查构建结果，生产托管采用以下方式。

## GitHub Pages

仓库已提供 [Deploy GitHub Pages](../.github/workflows/pages.yml)。首次上传源码不会自动开启公开网站。

1. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 在 **Actions → Deploy GitHub Pages → Run workflow** 选择 `main` 并执行。
3. 等待 `build` 和 `deploy` 成功，部署地址显示在 workflow 的 `github-pages` 环境中。当前仓库使用默认域名时，地址为 https://hongwbao.github.io/roadLab/ 。

若希望后续每次推送 `main` 自动更新，在 **Settings → Secrets and variables → Actions → Variables** 添加仓库变量：

```text
PAGES_ENABLED=true
```

不设置该变量时仍可手动发布。发布使用 GitHub 自动提供的 `GITHUB_TOKEN` 和 OIDC，不需要个人访问令牌。Workflow 根据 Pages 返回的路径设置构建 `base`，可用于仓库子路径或自定义域名。

GitHub 的发布来源设置与 workflow 的首次运行均完成后，网站才会可访问；仓库有部署文件不代表已上线。

## Docker Compose

需要 Docker Engine 和 Docker Compose。项目使用 Node.js 24 构建，再由 Nginx 提供静态文件，最终镜像不包含 Node.js、测试和开发依赖。

```bash
docker compose up -d --build
```

打开 http://localhost:8080/ 。在服务器上访问 `http://服务器IP:8080/`。

```bash
# 更新
 git pull --ff-only
 docker compose up -d --build

# 查看状态与日志
 docker compose ps
 docker compose logs -f --tail=100

# 停止
 docker compose down
```

端口可用环境变量配置，例如 Linux/macOS：

```bash
ROADLAB_PORT=9000 docker compose up -d --build
```

也可在项目 `.env` 中写入 `ROADLAB_PORT=9000`，再执行原命令。健康检查地址为 `/healthz`。Nginx 配置见 [deploy/nginx.conf](../deploy/nginx.conf)：HTML 不长期缓存，带 hash 的资源长期缓存，避免发布后继续加载旧入口。

网站部署到公网域名时，可在容器前使用已有的 HTTPS 反向代理。Compose 默认提供 HTTP 8080，不自动申请证书或修改宿主机服务。

## 其他静态服务器

```bash
npm ci
npm run build
```

将 `dist/` 的内容上传到 Nginx、对象存储或其他静态托管服务的网站目录。根路径部署不需要额外配置。Nginx 可参考 `deploy/nginx.conf`，根据服务器调整 `root`、监听端口和域名。

如果部署在 `/roadLab/` 等子目录，构建时指定相同前缀：

```bash
npm run build -- --base=/roadLab/
```

也可复制 `.env.example` 为 `.env`，设置 `VITE_BASE_PATH=/roadLab/` 再构建。`base` 必须与网页实际访问路径一致，包含前后斜杠。修改部署路径后需要重新构建，不能只移动原构建文件。

## 发布前验证

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run test:smoke
```

Linux 的最小环境使用 `npx playwright install --with-deps chromium`。本地可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 复用已有浏览器，CI 使用 Playwright 管理的 Chromium。若 5173 已被本地开发服务占用，可用 `PLAYWRIGHT_PORT=5174 npm run test:e2e` 启动独立测试服务。

验证子路径构建，Linux/macOS 示例：

```bash
npm run build -- --base=/roadLab/
SMOKE_BASE_PATH=/roadLab/ npm run test:smoke
```

验证已运行的静态服务器或容器：

```bash
SMOKE_URL=http://127.0.0.1:8080/ npm run test:smoke
```

仓库 [CI](../.github/workflows/ci.yml) 在推送 `main` 和拉取请求中检查格式、类型、核心测试、浏览器操作、构建产物，并实际构建和运行 Docker 镜像进行浏览器检查。输出位于 `artifacts/` 和 `test-results/`；CI 失败时上传诊断产物。

## 数据保存与迁移

地图保存在浏览器 localStorage，按浏览器和网站 origin 隔离。部署到其他域名不会自动带走旧网址的地图；在旧地址导出 JSON，再在新地址导入。发布更新不主动清空保存的地图，`interchange-lab:v1` 是为兼容已有地图而保留的存储键。

## 常见问题

| 现象                   | 检查与处理                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Pages 404              | 检查 Pages 来源是否为 GitHub Actions、发布 workflow 是否成功、地址是否包含仓库路径。 |
| 页面空白且资源 404     | 检查构建 `base` 是否与部署路径一致，再重新构建。                                     |
| 找不到 Chromium        | 执行 `npx playwright install chromium`，或指定可用浏览器路径。                       |
| Docker 无法连接 daemon | 确认 Docker Engine 已运行且当前账户具备使用权限。                                    |
| 在新网址找不到原地图   | 从旧网址导出 JSON 后导入；自动保存不会跨 origin 迁移。                               |
