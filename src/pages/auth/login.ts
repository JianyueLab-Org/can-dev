import type { APIRoute } from "astro";

import { authorizeUrl, newVerifier } from "@/lib/canApi";
import { safeNext, writePending } from "@/lib/session";
import crypto from "node:crypto";

/**
 * 去 can-web 登录。
 *
 * `state` 和 PKCE 的 verifier 一起封进 pending cookie，回调时比对；两者都是
 * 32 字节随机。state 挡的是 CSRF（别人把他的授权码塞进你的浏览器），verifier
 * 挡的是授权码在回来的路上被截走。
 */
export const GET: APIRoute = ({ cookies, url, redirect }) => {
  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = newVerifier();

  writePending(cookies, {
    state,
    verifier,
    next: safeNext(url.searchParams.get("next")),
  });

  return redirect(authorizeUrl(state, verifier), 302);
};
