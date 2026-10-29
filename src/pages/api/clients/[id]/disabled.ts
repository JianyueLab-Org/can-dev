import type { APIRoute } from "astro";

import { setClientDisabled } from "@/lib/canApi";
import { relay, requireSession } from "@/lib/guard";

export const POST: APIRoute = async (context) => {
  const guard = requireSession(context);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json(
      { error: "invalid_request", message: "请求体不是 JSON。" },
      { status: 400 },
    );
  }

  const result = await setClientDisabled(
    guard.session.accessToken,
    context.params.id ?? "",
    body,
  );
  if (!result.ok) return relay(result);
  return Response.json({ data: result.data });
};
