# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CAN 开发者中心。成员在这里自助注册 OAuth 应用；它接管的是
`scripts/oauth-client.mjs` 手工干的事，读写同一张 `oauthClient` 表。它同时是
**公开接口文档**的家（`/docs`）—— 那个页面原来在 can-web 的 `/developers`。
Astro SSR + Vue 岛屿 + Tailwind v4，形状照 can-web。README 是给人读的那一份。

上游是**两个**地址：`CAN_API_ORIGIN` 是 can-api，OIDC 的 issuer，换令牌、
userinfo、吊销和 `/api/v1/dev/clients` 都在那儿；`CAN_WEB_ORIGIN` 只剩同意页
`/oauth/authorize` —— 那是渲染给人看的页面，没有跟着数据层搬进 Go。两者共用同
一个数据库，授权码由 can-web 写进 `oauthCode`、由 can-api 兑换。

## 命令

```bash
bun run dev        # :4322（4321 留给 can-web，两个常常同时开着）
bun run lint       # format:check + astro check —— CI 跑的就是这个
bun run build && bun run start
```

没有测试套件。门禁就是 `bun run lint` 加一次 `bun run build`。

## 三条不能动的规矩

**1. 访问令牌不进浏览器。** 会话是 AES-256-GCM 加密的 HttpOnly cookie
（`src/lib/session.ts`）；岛屿调本站的 `/api/clients/*`，服务端才拿着令牌去问
can-api。令牌能改回调地址，也就是能决定授权码送到哪儿 —— 一处 XSS 就等于全交
出去。新加的页面要数据，走同样的路：服务端取好当 prop 传进岛屿。

**2. 校验只有一份，在 can-api 的 `internal/oauth/registry.go`。** 回调地址规
则、保留应用名、能申请哪些 scope，都在那边；这边只显示它返回的 `message`。在前
端补一份「友好的即时校验」听起来无害，但两份规则会漂移，而**宽的那一份**会先被
人发现。

**3. `apps:manage` 只有手工注册的应用拿得到。** 它不在 can-api 的
`SelfServiceScopes` 里，这正是开发者中心自己必须手工注册的原因。别为了省事去改
那份名单 —— 一个自助拿到 `apps:manage` 的应用，可以给成员名下**另一个**应用换
上自己的回调地址，然后等下一次登录把授权码送过来。can-api 有一条测试专门盯着
这件事。

## 外壳和文案

**三个站共用一套设计系统，这个站是最后一个接上的。** `src/styles/globals.css`
是 can-web 那一份的镜像，`ThemeScript.astro`、`useOverlay.ts`、`ui/Icon.vue`、
`ui/ThemeLangControls.vue`、`ui/AlertBox.vue` 都是逐字相同的副本 —— 改动要在
can-web 那边发生，再同步过来。新页面套 `SiteLayout.astro`（站头 + 正文 +
页脚），不要自己再拼一遍那个三明治。

**颜色只用语义记号**，`bg-surface-*` / `text-ink|muted|faint` / `badge-*` /
`AlertBox`，不要写 `bg-red-50`、`bg-slate-100` 这类固定色阶。它们不跟随深色模
式：这个站从建站起就跟随系统深色，而 `AppManager.vue` 通篇是固定色阶，于是每
一个提示框在深色下都是浅底深字，一直没人发现。

**四种语言。** `src/lib/i18n.ts` 和另外两个站逐字相同，`NEXT_LOCALE` cookie
在父域上共享，所以在主站选的语言到这里仍然生效。词典分两半：`header`/`footer`
是 can-web 的镜像（改在那边再同步），`apiDocs`/`dev` 是本站自己的。

**`/docs` 印的是 can-api 的地址，不是 `Astro.url.origin`。** 在 can-web 上那两
者恰好相等，在这里差得很远 —— `platform.airwaysn.org/api/v1/atis` 是 404。而且
是**两个**地址：同意页 `/oauth/authorize` 在 can-web，其余全在 can-api，每个端
点用 `host` 字段说明自己归谁（`src/lib/apiDocs.ts` 的 `ApiHost`）。

## 别的

- `PUBLIC_ORIGIN` 拼出回调地址，必须和注册时填的一字不差（服务端整串精确匹
  配）。本机用 `127.0.0.1`，**不是 `localhost`** —— 后者要过名字解析，服务端
  不接受。
- 不申请 `offline_access`：这是个坐下来用的地方，会话跟着浏览器走就够了。
- 写操作的 Origin 检查在 `src/lib/guard.ts`，比对显式的 `PUBLIC_ORIGIN` 而不
  是用 Astro 的 `checkOrigin` —— 反代终止 TLS，Astro 从 Host 推出来的 origin
  是 `http://…`，永远对不上（can-web 关掉那个检查也是这个原因）。
- 部署见 `deploy/k8s.yaml`。`.github/workflows/deploy.yml` 出镜像并滚动
  Deployment，不再需要手工 `rollout restart`。jyl-tyo 的 kubectl 走 Omni 的
  OIDC，CI 里非交互地过不去，所以 CI 用的是直连 API server 的 `deployer` 服务
  账号（`KUBECONFIG_B64`）。
