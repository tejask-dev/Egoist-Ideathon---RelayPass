import { randomBytes } from "node:crypto";

export const DEMO_SESSION_COOKIE = "relaypass_demo_session";
export const DEMO_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60;

export function createOpaqueDemoSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function isOpaqueDemoSessionId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));
}

export function demoSessionCookieOptions(production = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/api/demo",
    maxAge: DEMO_SESSION_MAX_AGE_SECONDS,
    priority: "high" as const,
  };
}
