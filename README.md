# can-dev — CAN 开发者中心

Cerulean Aviation Network 的开发者中心：成员在这里自助注册 OAuth 应用，管理
回调地址、权限和密钥。它接管的是 can-web 里 `scripts/oauth-client.mjs` 原本手
工干的事 —— 读写的是同一张 `oauthClient` 表。

Astro SSR（standalone Node 适配器）+ Vue 岛屿 + Tailwind v4，和 can-web 同一套
形状。

## 它自己也是一个 OAuth 应用

开发者中心用 can-web 的统一登录认人，授权码 + PKCE，**机密客户端**。它要的
`apps:manage` 不在自助注册的名单里（`SELF_SERVICE_SCOPES`），所以它必须在
can-web 那边手工注册：

```bash
# 在 can-web 仓库，需要 DATABASE_URL
bun run scripts/oauth-client.mjs create can-dev \
  --name "CAN 开发者中心" \
  --redirect https://platform.airwaysn.org/auth/callback \
  --scopes "openid profile apps:manage" \
  --trusted --website https://platform.airwaysn.org
```

打印出来的 `client_secret` 只出现这一次。回调地址要和 `PUBLIC_ORIGIN` 拼出来
的**一字不差** —— can-web 那边是整串精确匹配。

## 开发

```bash
cp .env.example .env      # 填 CAN_CLIENT_SECRET 和 SESSION_SECRET
bun install
bun run dev               # http://127.0.0.1:4322

bun run lint              # format:check + astro check，CI 跑的就是这个
bun run build && bun run start
```

本机调试时把 `CAN_ISSUER` 指向本地的 can-web（`http://127.0.0.1:4321`），并且
给它注册一个回调地址是 `http://127.0.0.1:4322/auth/callback` 的应用 ——
`127.0.0.1` 是被接受的（RFC 8252 环回），`localhost` 不是。

## 环境变量

| 变量                | 说明                                              |
| ------------------- | ------------------------------------------------- |
| `CAN_ISSUER`        | can-web 的地址，默认 `https://airwaysn.org`       |
| `CAN_CLIENT_ID`     | 默认 `can-dev`                                    |
| `CAN_CLIENT_SECRET` | 注册时打印的那一次                                |
| `PUBLIC_ORIGIN`     | 本部署的对外地址，回调地址由它拼出                |
| `SESSION_SECRET`    | 会话 cookie 的加密密钥，`openssl rand -base64 32` |

## 几件值得知道的事

**访问令牌从不进浏览器。** 会话是一个 AES-256-GCM 加密的 HttpOnly cookie，页
面里的 Vue 岛屿调的是本站的 `/api/clients/*`，由服务端拿着令牌去问 can-web。
令牌能改一个应用的回调地址，也就是能决定授权码送到哪儿去 —— 这种东西放进
`localStorage`，一处 XSS 就等于全交出去。

**校验只有一份，在 can-web。** 回调地址的规则、保留的应用名、能申请哪些
scope，全在 can-web 的 `src/server/oauth/registry.ts`，这边只把它返回的
`message` 显示出来。前端再抄一遍的下场是两份规则慢慢对不上，而宽的那一份会先
被人发现。

**不申请 `offline_access`。** 开发者中心是坐下来用的地方，会话跟着浏览器走就
够了；少一种长期凭据就少一种会泄露的东西。

## 部署

见 [`deploy/k8s.yaml`](deploy/k8s.yaml)（jyl-tyo 集群）。镜像由
`.github/workflows/image.yml` 推到 GHCR；上线是手工的一条 `rollout restart`，
因为那个集群的 kubectl 走 Omni 的 OIDC 认证，CI 里过不去。
