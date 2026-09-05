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

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 授权 GitHub，选仓库 **`pluchon/link_cloudfare_website`**。
3. 构建设置填：

| 项 | 值 |
|----|-----|
| Production branch | `main` |
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |

4. **Save and Deploy**，等构建变绿。
5. 打开系统给的地址：`https://<项目名>.pages.dev`  
   **这一步通了再改域名 DNS**，否则分不清是构建挂了还是解析挂了。

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
