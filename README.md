# can-dev — CAN 开发者中心

Cerulean Aviation Network 的开发者中心：成员在这里自助注册 OAuth 应用，管理
回调地址、权限和密钥。它接管的是 `scripts/oauth-client.mjs` 原本手工干的事 ——
读写的是同一张 `oauthClient` 表。

`/docs` 是**接口文档** —— 网络对外开放的那几个端点，连同统一登录的完整说明。
**要登录**：读它的人是来注册应用的，而注册应用本来就需要一个成员账号。它原来在
主站的 `ceruleanavi.net/developers`，那个地址现在是一条 301 —— 指向本站**首页**
而不是这一页，好让沿旧地址过来的未登录访客落在一页能说明情况、带着登录入口的页
面上，而不是一堵登录墙。

`/ground` 是**地面图预览**：把 Ground 仓库的 json 按扇区包里那个地面插件
（GroundMap）的画法画出来。不要登录，也不发一个请求 —— 文件由你自己拖进浏览
器，在本地解析。改完一个机场的 `airports/<ICAO>.json` 直接拖进来就能看，不必
先跑 `merge.py` 再开 EuroScope。

`/health` 给外部监控用：不经会话，查 can-api 的 `/health`，通过 200，失败 503，
`no-store`，结果缓存 10 秒。k8s 探针不指它。

Astro SSR（standalone Node 适配器）+ Vue 岛屿 + Tailwind v4。外壳是 can-ui 的
`CanFrame`，四语言词典用 `createSiteI18n`。

## 它自己也是一个 OAuth 应用

开发者中心用网络的统一登录认人，授权码 + PKCE，**机密客户端**。它要的
`apps:manage` 不在自助注册的名单里（can-api 的 `SelfServiceScopes`），所以它必
须手工注册：

```bash
# 在 can-web 仓库，需要 DATABASE_URL
bun run scripts/oauth-client.mjs create can-dev \
  --name "CAN 开发者中心" \
  --redirect https://platform.ceruleanavi.net/auth/callback \
  --scopes "openid profile apps:manage" \
  --trusted --website https://platform.ceruleanavi.net
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

bun run lint              # format:check + astro check + bun test
bun run check:pages       # 站点注册表里的页面都有路由
bun run build && bun run start
```

本机调试要指两个地址：`CAN_API_ORIGIN` 指本地的 can-api，`CAN_WEB_ORIGIN` 指
本地的 can-web（`http://127.0.0.1:4321`，同意页在那儿）。再注册一个回调地址是
`http://127.0.0.1:4322/auth/callback` 的应用 —— `127.0.0.1` 是被接受的
（RFC 8252 环回），`localhost` 不是。

## 环境变量

| 变量                       | 说明                                                    |
| -------------------------- | ------------------------------------------------------- |
| `CAN_API_ORIGIN`           | can-api，默认 `https://api.ceruleanavi.net`             |
| `CAN_WEB_ORIGIN`           | can-web，只用来拼同意页，默认 `https://ceruleanavi.net` |
| `CAN_CLIENT_ID`            | 默认 `can-dev`                                          |
| `CAN_CLIENT_SECRET`        | 注册时打印的那一次                                      |
| `PUBLIC_ORIGIN`            | 本部署的对外地址，回调地址由它拼出                      |
| `SESSION_SECRET`           | 会话 cookie 的加密密钥，`openssl rand -base64 32`       |
| `PUBLIC_CAN_<SITE>_ORIGIN` | 外壳里其它站的地址，构建期内联，不设用生产地址          |

## 几件值得知道的事

**访问令牌从不进浏览器。** 会话是一个 AES-256-GCM 加密的 HttpOnly cookie，页
面里的 Vue 岛屿调的是本站的 `/api/clients/*`，由服务端拿着令牌去问 can-api。
令牌能改一个应用的回调地址，也就是能决定授权码送到哪儿去 —— 这种东西放进
`localStorage`，一处 XSS 就等于全交出去。

**本站会话绑定当前网络身份。** 每次使用 `can_dev_session` 前，服务端只带
`can_session` 查询 can-api 的 `/api/v1/auth/session`，身份须与访问令牌所属成员
一致。网络会话缺失、失效、换号或无法核实时，清本站会话并后台吊销本站令牌，
不清网络 cookie。开发者资格和评级取当前网络身份；应用管理没有额外评级门槛。
OAuth 回调也核实网络身份与 userinfo 的主体一致后才发放本站会话。

**校验只有一份，在 can-api。** 回调地址的规则、保留的应用名、能申请哪些
scope，全在 can-api 的 `internal/oauth/registry.go`。应用名称去除首尾空白后须为
1–120 个 UTF-8 字节；`invalid_name` 显示四语言提示，`name_reserved` 和其他错误
仍显示上游 `message`。前端不重复校验。

**停用和启用走独立端点。** 应用卡片发送
`POST /api/clients/{id}/disabled`，服务端转到 can-api 的
`POST /api/v1/dev/clients/{id}/disabled`。请求体的 `disabled` 是必填布尔值；
成功返回 `{"data":{"disabled":true}}`（启用时为 `false`），之后才刷新列表。
本站检查会话、开发者身份和写入 Origin，Bearer 令牌只在服务端转发。
can-api 再检查 `apps:manage`、当前开发者资格和应用所有权。
停用会吊销已发出的令牌；重新启用不会恢复这些令牌。

**上游是两个地址。** issuer 和所有 API 调用在 can-api；同意页
`/oauth/authorize` 还在 can-web，因为它是渲染给人看的页面，带着主站的样式和会
话，没有跟着数据层搬进 Go。RFC 8414 允许 `authorization_endpoint` 落在别的源
上，can-api 的 discovery 文档正是这么写的。

**不申请 `offline_access`。** 开发者中心是坐下来用的地方，会话跟着浏览器走就
够了；少一种长期凭据就少一种会泄露的东西。

**地面图预览是 `merge.py` 和 `GroundMap.cpp` 的第二份实现。** 它们不在这个仓
库里（Ground / Sector），所以这两份代码只能靠自觉跟上 —— 逐字照抄，连
`merge.py` 把 `cos(36°)` 当纬度传给抽稀函数那个怪癖也抄了。改动那边而不改这边
的下场，是预览和管制员机器上装的那份对不上，而预览工具唯一不能犯的就是这个
错。对得上是可以证明的：拿一份合并好的 `ground.json` 和对应的
`airports/*.json` 比一遍，当前十个 FIR 的 117 个机场逐字节相同。

## 部署

见 [`deploy/k8s.yaml`](deploy/k8s.yaml)（jyl-tyo 集群）。
`.github/workflows/deploy.yml` 出镜像并滚动 Deployment，走组织里那份可复用工作
流，不再需要手工 `rollout restart`。集群的 kubectl 走 Omni 的 OIDC，CI 里非交
互地过不去，所以 CI 用的是直连 API server 的 `deployer` 服务账号
（`KUBECONFIG_B64`）。

Docker 构建上下文排除本地 `.env*`、依赖、生成产物、Git 元数据和商业
`data/navdata`，保留 `.npmrc`、源码、静态资源、词典和构建脚本。
运行时环境变量由部署注入；包令牌通过 `github_token` BuildKit secret 提供。

Each deployment first calls the local `check.yml` in the same run.
Lint, build, and page checks must pass before deployment starts.
Checks use Bun `1.4.2` and only the automatic `GITHUB_TOKEN`; no production secrets are forwarded.
The shared deployment workflow is pinned to `f88d7b04291aa9076f26949fa35bb04a6baa9cc1` and uses Bun `1.4.2`.
Only `KUBECONFIG_B64` and `GHCR_PULL_TOKEN` are explicitly forwarded to deployment.
