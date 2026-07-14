# NovelAI Vibe Web

公开可访问的 BYOK（Bring Your Own Key）Vibe 生成网站：访问者上传参考图、填写自己的 NovelAI Token，服务端临时代理调用 `/ai/encode-vibe`，然后下载 `.naiv4vibe`。

## 隐私与架构

由于 NovelAI API 可能受浏览器跨域限制，本项目采用“前端 + Node.js 代理”，不是纯静态网站。访问者的 Token：

- 只随当前 HTTPS 生成请求发送；
- 只在服务端该次请求的内存中使用；
- 不写入文件、数据库、Cookie 或 localStorage；
- 不包含在响应中；
- 当前服务端不记录请求体。

站点运营者在技术上仍有能力修改服务端来读取 Token，因此访问者只能在信任的部署站点输入 Token。公开部署必须启用 HTTPS。

## 本地运行

需要 Node.js 18+：

```bash
npm start
```

打开 `http://localhost:3000`，在页面中填写访问者自己的 Token。服务端不需要配置 `NOVELAI_TOKEN`。

## 部署为公开网站

### Render

1. 将项目上传到 GitHub，确保没有提交 `.env`。
2. 在 Render 新建 Blueprint 或 Web Service并连接仓库。
3. 使用 `npm start` 启动；无需设置 NovelAI Token。
4. 部署完成后使用 Render 提供的 HTTPS 地址。

项目包含 `render.yaml`。

### Railway

1. 将项目上传到 GitHub。
2. 在 Railway 选择 Deploy from GitHub Repo。
3. 在 Networking 中生成公开域名；无需设置 NovelAI Token。

项目包含 `Dockerfile` 和 `railway.json`。

### Docker

```bash
docker build -t novelai-vibe-web .
docker run -d --name novelai-vibe-web -p 3000:3000 novelai-vibe-web
```

生产环境应通过 Nginx/Caddy 配置 HTTPS，并反向代理到 `127.0.0.1:3000`。

## 配置

- `NOVELAI_API_BASE`：默认 `https://image.novelai.net`。
- `PORT`：默认 `3000`。
- `MAX_IMAGE_BYTES`：默认 10 MB。
- `RATE_LIMIT_MAX`：每个 IP 在时间窗口内允许的请求数，默认 10。
- `RATE_LIMIT_WINDOW_MS`：限流窗口，默认 3600000 毫秒。
- `UPSTREAM_TIMEOUT_MS`：上游超时，默认 60000 毫秒。

## 上游请求

服务端从本次请求中取得访问者 Token，并作为 Bearer Token 调用 NovelAI：

```json
{
  "image": "纯 Base64，不含 Data URL 前缀",
  "information_extracted": 1,
  "model": "nai-diffusion-4-5-full"
}
```

上游成功响应按二进制读取并转 Base64。下载文件是 JSON，扩展名为 `.naiv4vibe`，顶层 `identifier` 为 `novelai-vibe-transfer`。

模型键映射：

- `nai-diffusion-4-5-full` → `v4-5full`
- `nai-diffusion-4-5-curated` → `v4-5curated`
- `nai-diffusion-4-full` → `v4full`
- `nai-diffusion-4-curated-preview` → `v4curated`

## 测试范围

已完成 Node 语法、静态页面、模拟上游端到端、文件结构及 NovelAI 官方编码接口真实请求测试。尚未在 NovelAI 官方界面中人工导入生成文件。