import type { APIRoute } from "astro";

import { handleNotifications } from "@/lib/notifications";

/**
 * 通知铃：`/api/v1/notifications`、`…/unread`、`…/read-all`、
 * `…/{member|broadcast}/{id}`。逻辑和测试在 `@/lib/notifications`。
 */
export const GET: APIRoute = (context) => handleNotifications(context);
export const POST = GET;
export const PATCH = GET;
