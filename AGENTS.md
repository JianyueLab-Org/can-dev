# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CAN 开发者中心。成员在这里自助注册 OAuth 应用；它接管的是
`scripts/oauth-client.mjs` 手工干的事，读写同一张 `oauthClient` 表。它同时是
**接口文档**的家（`/docs`，原来在 can-web 的 `/developers`）和**地面图预览**的
家（`/ground`，见下）。
Astro SSR + Vue 岛屿 + Tailwind v4，形状照 can-web。README 是给人读的那一份。

**`/docs` 要登录，首页和 `/ground` 不要。** 文档从前是公开的；读它的人是来注册
应用的，而注册应用本来就需要一个成员账号，所以这道门槛不挡真正要用它的人。首页
留在门外是这件事的**另一半**：未登录的访客要有一页能说明这个站是什么、并把他送
去登录，否则「开发者中心」在全网菜单里就是一条谁也点不动的链接。can-ui 的站点注
册表因此把那一条从 `/docs` 改指首页 —— 两处要一起看，只改一边不是把菜单指向登录
墙，就是让文档重新暴露。

上游是**两个**地址：`CAN_API_ORIGIN` 是 can-api，OIDC 的 issuer，换令牌、
userinfo、吊销和 `/api/v1/dev/clients` 都在那儿；`CAN_WEB_ORIGIN` 只剩同意页
`/oauth/authorize` —— 那是渲染给人看的页面，没有跟着数据层搬进 Go。两者共用同
一个数据库，授权码由 can-web 写进 `oauthCode`、由 can-api 兑换。

## 命令

```bash
bun run dev        # :4322（4321 留给 can-web，两个常常同时开着）
bun run lint       # format:check + astro check + bun test
bun run check:pages # 站点注册表里的页面都有路由
bun run build && bun run start

# 地面图那两份移植有没有漂（要本地有 Ground 和 Sector 两个仓库；不在 CI 里）
bun run verify:ground
```

门禁是 `bun run lint`、`bun run build`、`bun run check:pages`，CI（`.github/workflows/check.yml`）跑同样三条。

**测试有五份**（`bun test`，只多一个 `@types/bun` 让 `astro check` 认得
`bun:test`）。判据和 can-efb 那边一样 —— 「错了会不会被屏幕出卖」。

- `src/lib/signout.test.ts`：`POST /api/v1/auth/signout` 的 Origin 检查、吊销、
  转发和 `Set-Cookie`。它是唯一一条不经过 `requireSession()` 的写操作。
- `src/lib/networkSession.test.ts`：中间件那条规则 —— 有 `can_dev_session`
  没有 `can_session`，就吊销令牌、清掉本站会话。
- `src/lib/notifications.test.ts`：通知铃的五条路径、Origin 检查、只带
  `can_session`、204 和 `Set-Cookie` 原样回来。

测试文件放在 `src/lib/` 而不是挨着被测的路由：`src/pages/` 下每一个 `.ts` 都是一条
路由。

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

## `/ground` —— 站上唯一没有上游的一页

**它是 `merge.py` 和 `GroundMap.cpp` 的第二份实现。** `src/lib/groundMap.ts` 是
`Ground/tools/merge.py` 的浏览器版，`src/lib/groundRender.ts` 是
`Sector/tools/RJJJ/GroundMap/GroundMap.cpp` 的 canvas 版。两份源头都不在
这个仓库里，也没有任何 CI 会替我们发现它们对不上 —— 所以两边都是**逐字照抄，
连怪癖一起抄**：merge.py 把 `cos(36°)` 当纬度传给抽稀函数，这边也这么传；
Direct2D 的虚线段长以描边宽度为单位、线帽是平的，这边也乘回去、也用 `butt`。
在这里"顺手改正确一点"，预览就和管制员机器上装的那份对不上了，而那是一个预览
工具唯一不能犯的错。

对得上是**可以证明的**，改完跑一次 `bun run verify:ground`：它
拿 `Ground/<FIR>/airports/*.json` 加 `<FIR>.sct`、`GRpluginStands.txt` 跑一遍
`buildAirportFromSource`，和 `Sector/<FIR>/Plugins/GroundMap/ground.json` 里对
应的机场逐字节比较，漂了就非零退出。写下这段时十个 FIR、137 处检查（117 个机
场加 20 个 world 图层）全部相同。两个参数的 `undefined` 和 `[]` 不是一回事：
`undefined` 是"没有扇区文件，跑道用 OSM 近似"，`[]` 是"扇区文件在，但它没有这
个机场的跑道行"（ZL02、ZL03 那种只在站位表里的场，产物里本来就没有跑道层）。

**文件编码也是移植的一部分**，而且是这个校验唯一一次真的抓到东西的地方。十个大
陆 `.sct` 和九份 `GRpluginStands.txt` 里的五份是 GBK，剩下的是 UTF-8，文件里没有
一个字说自己是哪种。`decodeGroundText()` 是 `common.read_text()` 的逐行移植：先
严格 UTF-8（两种里只有它能被证明），再 GBK，最后才有损兜底。一律 `file.text()` 或
`readFileSync(p, "utf8")` 会把每个 GBK 机位名变成 U+FFFD —— 两边同时这么错的时候
这个脚本是绿的，只有这边解对了它才会指出产物没重新合并。

**不登录、不上传、没有后端路由**，这三件事是一件事。中间件的 `PROTECTED` 里没
有它：改扇区包的人不一定注册过 OAuth 应用。文件在浏览器里解析：地面数据跟着扇
区包走，不属于这个站，而这个站是公开的 —— 一个"传上来我帮你渲染"的按钮等于让
还没发布的扇区数据落到服务器上。

## 外壳和文案

**外壳是 can-ui 的 `CanFrame`**，`layout="content"`。`src/components/Frame.vue`
传导航、品牌、词典和 `originsFromEnv(import.meta.env)`。新页面套
`SiteLayout.astro`。页面不写 `<main>`：外壳渲染它、跳转链接和页脚。
`src/styles/globals.css` 只多一条 `.page-sunken`。

**颜色只用语义记号**，`bg-surface-*` / `text-ink|muted|faint` / `badge-*` /
`AlertBox`，不要写 `bg-red-50`、`bg-slate-100` 这类固定色阶。它们不跟随深色模
式：这个站从建站起就跟随系统深色，而 `AppManager.vue` 通篇是固定色阶，于是每
一个提示框在深色下都是浅底深字，一直没人发现。

**四种语言。** `src/lib/i18n.ts` 只有四个 JSON 和一次 `createSiteI18n`，缺键回退
简体。`NEXT_LOCALE` cookie 在父域上共享。`frame` 是外壳文案，覆盖 can-ui
`CHROME_MESSAGES` 的每一个键；`apiDocs`、`dev` 是本站自己的。

**`/docs` 印的是 can-api 的地址，不是 `Astro.url.origin`。** 在 can-web 上那两
者恰好相等，在这里差得很远 —— `platform.ceruleanavi.net/api/v1/atis` 是 404。而且
是**两个**地址：同意页 `/oauth/authorize` 在 can-web，其余全在 can-api，每个端
点用 `host` 字段说明自己归谁（`src/lib/apiDocs.ts` 的 `ApiHost`）。

## 别的

- `PUBLIC_ORIGIN` 拼出回调地址，必须和注册时填的一字不差（服务端整串精确匹
  配）。本机用 `127.0.0.1`，**不是 `localhost`** —— 后者要过名字解析，服务端
  不接受。
- 不申请 `offline_access`：这是个坐下来用的地方，会话跟着浏览器走就够了。
- 退出：`AccountMenu` 发 `POST /api/v1/auth/signout`。路由吊销本站令牌、清
  `can_dev_session`，再转发 can-api 的 `/api/v1/auth/signout`，原样带回它的
  `Set-Cookie`。之后原地刷新。第三方应用的令牌不吊销。
- 通知铃：`Frame.vue` 设 `notifications`。`src/pages/api/v1/notifications/[...path].ts`
  把五条路径转给 can-api，只带 `can_session`；写操作查 Origin。逻辑在
  `src/lib/notifications.ts`。
- 中间件：带 `can_dev_session` 没有 `can_session` 的请求，吊销令牌、清本站会话。
  `can_session` 在父域 `.ceruleanavi.net` 上，这个站看得见。本机开发时 can-api、
  can-web 和本站都要在 `127.0.0.1` 上，否则每个请求都像已在别处退出。
- 已登录但不是开发者：中间件把 `/apps`、`/docs` 改写到 `/no-access`，地址不变，
  渲染 `NoAccess`，403。直接访问 `/no-access` 跳回首页。
- 写操作的 Origin 检查在 `src/lib/guard.ts`，比对显式的 `PUBLIC_ORIGIN` 而不
  是用 Astro 的 `checkOrigin` —— 反代终止 TLS，Astro 从 Host 推出来的 origin
  是 `http://…`，永远对不上（can-web 关掉那个检查也是这个原因）。
- 部署见 `deploy/k8s.yaml`。`.github/workflows/deploy.yml` 出镜像并滚动
  Deployment，不再需要手工 `rollout restart`。jyl-tyo 的 kubectl 走 Omni 的
  OIDC，CI 里非交互地过不去，所以 CI 用的是直连 API server 的 `deployer` 服务
  账号（`KUBECONFIG_B64`）。
