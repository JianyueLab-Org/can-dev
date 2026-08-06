/// <reference types="astro/client" />

import type { Session } from "@/lib/session";

declare global {
  namespace App {
    interface Locals {
      /** 中间件解出来的会话；没登录是 null。 */
      session: Session | null;
    }
  }
}

export {};
