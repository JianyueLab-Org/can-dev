# can-dev — CAN 开发者中心

Cerulean Aviation Network 的开发者中心：成员在这里自助注册 OAuth 应用，管理
回调地址、权限和密钥。它接管的是 `scripts/oauth-client.mjs` 原本手工干的事 ——
读写的是同一张 `oauthClient` 表。

`/docs` 是**公开接口文档** —— 网络对外开放的那几个端点，连同统一登录的完整说
明。它原来在主站的 `airwaysn.org/developers`，那个地址现在是一条 301。

Astro SSR（standalone Node 适配器）+ Vue 岛屿 + Tailwind v4，和 can-web、
can-radar 共用同一套设计系统与四语言词典。

## 它自己也是一个 OAuth 应用

开发者中心用网络的统一登录认人，授权码 + PKCE，**机密客户端**。它要的
`apps:manage` 不在自助注册的名单里（can-api 的 `SelfServiceScopes`），所以它必
须手工注册：

```bash
# 在 can-web 仓库，需要 DATABASE_URL
bun run scripts/oauth-client.mjs create can-dev \
  --name "CAN 开发者中心" \
  --redirect https://platform.airwaysn.org/auth/callback \
  --scopes "openid profile apps:manage" \
  --trusted --website https://platform.airwaysn.org
```

打印出来的 `client_secret` 只出现这一次。回调地址要和 `PUBLIC_ORIGIN` 拼出来
的**一字不差** —— 服务端是整串精确匹配。

那个脚本写的是 `oauthClient` 表，而 can-api 读的是同一个库，所以数据层搬走之后
已经注册过的行不用重来：换的是主机，不是凭据。

## 开发

```bash
cp .env.example .env      # 填 CAN_CLIENT_SECRET 和 SESSION_SECRET
bun install
bun run dev               # http://127.0.0.1:4322

bun run lint              # format:check + astro check，CI 跑的就是这个
bun run build && bun run start
```

本机调试要指两个地址：`CAN_API_ORIGIN` 指本地的 can-api，`CAN_WEB_ORIGIN` 指
本地的 can-web（`http://127.0.0.1:4321`，同意页在那儿）。再注册一个回调地址是
`http://127.0.0.1:4322/auth/callback` 的应用 —— `127.0.0.1` 是被接受的
（RFC 8252 环回），`localhost` 不是。

## 环境变量

| 变量                | 说明                                                 |
| ------------------- | ---------------------------------------------------- |
| `CAN_API_ORIGIN`    | can-api，默认 `https://api.airwaysn.org`             |
| `CAN_WEB_ORIGIN`    | can-web，只用来拼同意页，默认 `https://airwaysn.org` |
| `CAN_CLIENT_ID`     | 默认 `can-dev`                                       |
| `CAN_CLIENT_SECRET` | 注册时打印的那一次                                   |
| `PUBLIC_ORIGIN`     | 本部署的对外地址，回调地址由它拼出                   |
| `SESSION_SECRET`    | 会话 cookie 的加密密钥，`openssl rand -base64 32`    |

## 几件值得知道的事

**访问令牌从不进浏览器。** 会话是一个 AES-256-GCM 加密的 HttpOnly cookie，页
面里的 Vue 岛屿调的是本站的 `/api/clients/*`，由服务端拿着令牌去问 can-api。
令牌能改一个应用的回调地址，也就是能决定授权码送到哪儿去 —— 这种东西放进
`localStorage`，一处 XSS 就等于全交出去。

**校验只有一份，在 can-api。** 回调地址的规则、保留的应用名、能申请哪些
scope，全在 can-api 的 `internal/oauth/registry.go`，这边只把它返回的
`message` 显示出来。前端再抄一遍的下场是两份规则慢慢对不上，而宽的那一份会先
被人发现。

**上游是两个地址。** issuer 和所有 API 调用在 can-api；同意页
`/oauth/authorize` 还在 can-web，因为它是渲染给人看的页面，带着主站的样式和会
话，没有跟着数据层搬进 Go。RFC 8414 允许 `authorization_endpoint` 落在别的源
上，can-api 的 discovery 文档正是这么写的。

**不申请 `offline_access`。** 开发者中心是坐下来用的地方，会话跟着浏览器走就
够了；少一种长期凭据就少一种会泄露的东西。

## 部署

见 [`deploy/k8s.yaml`](deploy/k8s.yaml)（jyl-tyo 集群）。
`.github/workflows/deploy.yml` 出镜像并滚动 Deployment，走组织里那份可复用工作
流，不再需要手工 `rollout restart`。集群的 kubectl 走 Omni 的 OIDC，CI 里非交
互地过不去，所以 CI 用的是直连 API server 的 `deployer` 服务账号
（`KUBECONFIG_B64`）。
