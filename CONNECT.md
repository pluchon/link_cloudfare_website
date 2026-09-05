# 打通指南：本地 ↔ GitHub ↔ Cloudflare Pages ↔ 阿里云 DNS

目标：改代码推送后，约 1 分钟内在 `https://www.nuonuoya.cn` 看到更新。  
**证书不用下载**；**阿里云 NS 保持不动**。

---

## 总览

```
本地 C:\JavaCode\items\personal_website
        │  git push
        ▼
GitHub  pluchon/link_cloudfare_website  (分支 main)
        │  自动触发构建
        ▼
Cloudflare Pages  → 先通 https://<项目>.pages.dev
        │  自定义域
        ▼
阿里云 DNS  www CNAME → <项目>.pages.dev
            @  显性 URL 301 → https://www.nuonuoya.cn
```

---

## 一、本地日常同步（你已经具备）

仓库已指向：`git@github.com:pluchon/link_cloudfare_website.git`

```powershell
cd C:\JavaCode\items\personal_website

# 开始改之前先拉（尤其用过网页 CMS 之后）
git pull

# 改完
git add .
git status
git commit -m "你的说明"
git push origin main
```

本地预览：

```powershell
npm install
npm run dev
```

浏览器打开终端里提示的 `http://localhost:4321`。

---

## 二、Cloudflare Pages 接 GitHub（你来点几下）

> **2026 控制台注意：** 「Create an app」默认常会进 **Workers** 向导（出现 **Deploy command = `npx wrangler deploy`**）。  
> 我们是 **纯静态 Astro**，应走 **Pages**，不要用这个 Deploy command。

### 正确入口（Pages）

1. 打开 [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)。
2. **Create** / **Create application** 之后，点顶部的 **Pages** 标签（不要停在 Workers）。
3. 选 **Import an existing Git repository** / **Connect to Git**。
4. 授权并选择仓库 **`pluchon/link_cloudfare_website`**。
5. 构建设置只填这些（官方 Astro + Pages 文档一致）：

| 项 | 值 |
|----|-----|
| Project name | 随意，例如 `link-cloudfare-website`（会变成 `*.pages.dev`） |
| Production branch | `main` |
| Build command | `npm run build` |
| **Build directory / Output directory** | **`dist`** |
| 环境变量（Advanced / Variables） | `NODE_VERSION` = `22` |

6. **不应出现**、或应忽略：**Deploy command / `npx wrangler deploy`**。静态 Pages 构建完直接发布 `dist`，不需要 wrangler。
7. API token 那一项若提示 “A new token will be created automatically”，**不用自己新建**，跳过即可。
8. **Save and Deploy**，等绿。打开 `https://<项目名>.pages.dev`。

**在 `*.pages.dev` 通之前，不要改域名 DNS。**

### 若你已经卡在「有 Deploy command」的那一页

点 **Back**，回到 Create 入口，改选 **Pages** 标签再 Import Git。  
不要在当前页点 Deploy——没有 `wrangler.toml` 时，`npx wrangler deploy` 会失败或部署错形态。

---

## 三、绑定自定义域 `www.nuonuoya.cn`

1. Pages 项目 → **Custom domains** → **Set up a domain**。
2. 填：`www.nuonuoya.cn` → Continue。
3. 记下 Cloudflare 提示的 CNAME 目标（一般是 `<项目名>.pages.dev`）。

**必须先在 Pages 里添加域名，再去阿里云写解析。** 只改 DNS 不添加域名，容易出现 522。

---

## 四、阿里云 DNS（NS 不要改）

控制台：阿里云云解析（当前 NS 是 `dns17/dns18.hichina.com`）。

| 主机记录 | 类型 | 记录值 | 说明 |
|----------|------|--------|------|
| `www` | **CNAME** | `<项目名>.pages.dev` | 以 Pages 控制台提示为准；TTL 可 10 分钟 |
| `@` | **显性 URL** | `https://www.nuonuoya.cn` | 301 跳到 www |
| `_dnsauth` | TXT | （保持原值） | 阿里云验证用，别删 |

注意：

- 原来暂停的 `www` **A** 记录（`175.178.64.249`）请停用或删除，避免和 CNAME 冲突。
- **不要**把 DNS 服务器改成 Cloudflare 的 NS。

---

## 五、怎么验收「连通成功」

1. `https://<项目>.pages.dev` 能打开本占位页。
2. `https://www.nuonuoya.cn` 能打开，浏览器锁头正常（证书 Cloudflare 自动签）。
3. 访问 `http://nuonuoya.cn` 或 `https://nuonuoya.cn` 会跳到 www。
4. 故意改一行首页文案 → `git push` → 约 1 分钟后线上更新。

本地查 CNAME（PowerShell）：

```powershell
Resolve-DnsName www.nuonuoya.cn -Type CNAME
```

---

## 六、常见坑

| 现象 | 原因 |
|------|------|
| 522 | Pages 里没添加自定义域，或只写了 DNS |
| www 打不开 / 指到旧站 | 旧 A 记录还在，和 CNAME 冲突 |
| Pages 构建失败 | 没设 `NODE_VERSION=22`，或 build/output 填错 |
| 推了没更新 | 等构建跑完；看 Pages 部署日志是否绿 |

---

## 七、本仓库约定

- 工作目录：`C:\JavaCode\items\personal_website`
- 生产分支：`main`
- 站点正式 URL：`https://www.nuonuoya.cn`
- 页脚不展示备案号（配置里仅备查）
