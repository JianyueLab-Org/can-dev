import type { APIRoute } from "astro";

import { deleteClient, updateClient } from "@/lib/canApi";
import { relay, requireSession } from "@/lib/guard";

export const PATCH: APIRoute = async (context) => {
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

  const result = await updateClient(
    guard.session.accessToken,
    context.params.id ?? "",
    body,
  );
  if (!result.ok) return relay(result);
  return Response.json({ data: result.data });
};

export const DELETE: APIRoute = async (context) => {
  const guard = requireSession(context);
  if (!guard.ok) return guard.response;

  const result = await deleteClient(
    guard.session.accessToken,
    context.params.id ?? "",
  );
  if (!result.ok) return relay(result);
  return Response.json({ data: result.data });
};
