import type { APIRoute } from "astro";

import { rotateSecret } from "@/lib/canApi";
import { relay, requireSession } from "@/lib/guard";

/** 换密钥。响应里的 clientSecret 是它唯一一次出现，前端负责让成员抄走。 */
export const POST: APIRoute = async (context) => {
  const guard = requireSession(context);
  if (!guard.ok) return guard.response;

  const result = await rotateSecret(
    guard.session.accessToken,
    context.params.id ?? "",
  );
  if (!result.ok) return relay(result);
  return Response.json({ data: result.data });
};
