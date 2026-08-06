import type { APIRoute } from "astro";

import { createClient, listClients } from "@/lib/canApi";
import { relay, requireSession } from "@/lib/guard";

/**
 * 页面里的岛屿要读写应用时走这里，而不是直接打 can-web。
 *
 * 这一层唯一的工作就是**把访问令牌留在服务端**：cookie 是加密的、HttpOnly 的，
 * 浏览器里的 JavaScript 既读不到它也不需要读到它。校验一概不在这里做 —— 规则
 * 属于 can-web 的 registry.ts，在两处各写一遍就是让它们开始漂移。
 */

export const GET: APIRoute = async (context) => {
  const guard = requireSession(context);
  if (!guard.ok) return guard.response;

  const result = await listClients(guard.session.accessToken);
  if (!result.ok) return relay(result);
  return Response.json({ data: result.data });
};

export const POST: APIRoute = async (context) => {
  const guard = requireSession(context);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json(
      { error: "invalid_body", message: "请求体不是 JSON。" },
      { status: 400 },
    );
  }

  const result = await createClient(guard.session.accessToken, body);
  if (!result.ok) return relay(result);
  return Response.json({ data: result.data }, { status: 201 });
};
