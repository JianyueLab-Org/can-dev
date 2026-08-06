# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CAN 开发者中心。成员在这里自助注册 OAuth 应用；它接管的是 can-web 里
`scripts/oauth-client.mjs` 手工干的事，读写同一张 `oauthClient` 表。
Astro SSR + Vue 岛屿 + Tailwind v4，形状照 can-web。README 是给人读的那一份。

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
can-web。令牌能改回调地址，也就是能决定授权码送到哪儿 —— 一处 XSS 就等于全交
出去。新加的页面要数据，走同样的路：服务端取好当 prop 传进岛屿。

**2. 校验只有一份，在 can-web 的 `src/server/oauth/registry.ts`。** 回调地址
规则、保留应用名、能申请哪些 scope，都在那边；这边只显示它返回的 `message`。
在前端补一份「友好的即时校验」听起来无害，但两份规则会漂移，而**宽的那一份**
会先被人发现。

**3. `apps:manage` 只有手工注册的应用拿得到。** 它不在 can-web 的
`SELF_SERVICE_SCOPES` 里，这正是开发者中心自己必须手工注册的原因。别为了省事
去改那份名单 —— 一个自助拿到 `apps:manage` 的应用，可以给成员名下**另一个**应
用换上自己的回调地址，然后等下一次登录把授权码送过来。

## 别的

- `PUBLIC_ORIGIN` 拼出回调地址，必须和注册时填的一字不差（can-web 那边整串精
  确匹配）。本机用 `127.0.0.1`，**不是 `localhost`** —— 后者要过名字解析，
  can-web 不接受。
- 不申请 `offline_access`：这是个坐下来用的地方，会话跟着浏览器走就够了。
- 写操作的 Origin 检查在 `src/lib/guard.ts`，比对显式的 `PUBLIC_ORIGIN` 而不
  是用 Astro 的 `checkOrigin` —— 反代终止 TLS，Astro 从 Host 推出来的 origin
  是 `http://…`，永远对不上（can-web 关掉那个检查也是这个原因）。
- 部署见 `deploy/k8s.yaml`。镜像由 CI 推到 GHCR，上线是手工 `rollout restart`：
  jyl-tyo 的 kubectl 走 Omni 的 OIDC 认证，CI 里过不去。
