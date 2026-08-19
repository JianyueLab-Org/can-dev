/**
 * can-api 那张限流表，取来给文档页用。
 *
 * 文档里**不写死数字**：页面按 key 去查运行中的表，渲染出来的就是实际生效的
 * 那个值。这条规矩是从 can-web 一起搬过来的，它成立的前提是这次取数不能出岔
 * 子，所以三件事：
 *
 * - **失败返回空表**，页面把每一条都渲染成「不限流」而不是一个过期的数字，也
 *   绝不 500。一个装饰性的数字没有资格把整页接口文档打掉。
 * - **进程内缓存**。这张表只在 can-api 部署时才变，而文档页是公开的、可能被
 *   爬；每次渲染都往上游打一次没有意义。失败缓存得短一些，好让上游恢复后很快
 *   自愈。
 * - **硬超时**。SSR 没有「稍后再加载」这个选项，慢比错更难查。
 *
 * 走的是匿名请求：`/api/v1/meta/limits` 不需要会话，拿会话令牌去取一张公开的表
 * 只会平白多一条会过期的依赖。（这句从前的后半是「而这个页面本身也不需要登录」
 * —— 那已经不成立了，接口文档现在要登录，见 `src/middleware.ts`。理由的前半仍
 * 然成立，而且更强：这张表是**进程内缓存**、所有读者共用一份，用某一个人的令牌
 * 去取它本来就是错的搭配。）
 */
import { apiOrigin } from "./config";

export interface LimitRule {
  limit: number;
  windowMs: number;
}

export type LimitTable = Record<string, LimitRule>;

const TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 3000;

let cache: { table: LimitTable; until: number } | null = null;

export async function fetchLimits(): Promise<LimitTable> {
  if (cache && cache.until > Date.now()) return cache.table;

  let table: LimitTable = {};
  let ok = false;

  try {
    const response = await fetch(new URL("/api/v1/meta/limits", apiOrigin()), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) {
      // can-api 的信封是 {status, data, timestamp}，表在 data.limits 下。
      const body = (await response.json()) as {
        data?: { limits?: LimitTable };
      };
      table = body.data?.limits ?? {};
      ok = true;
    }
  } catch {
    // 上游不通、超时、返回的不是 JSON —— 结果都一样：这一版没有数字可写。
  }

  cache = { table, until: Date.now() + (ok ? TTL_MS : FAILURE_TTL_MS) };
  return table;
}
