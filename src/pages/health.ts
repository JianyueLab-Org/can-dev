import type { APIRoute } from "astro";

import { handleHealth } from "@/lib/health";

/** 外部监控用的 `/health`，不经会话。逻辑和测试在 `@/lib/health`。 */
export const GET: APIRoute = () => handleHealth();
export const HEAD: APIRoute = async () => {
  const response = await handleHealth();
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
};
