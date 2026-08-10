import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

import {
  createOpaqueDemoSessionId,
  demoSessionCookieOptions,
  isOpaqueDemoSessionId,
} from "../demo-session-cookie";
import { DemoSessionRecordSchema, createDemoSessionRecord } from "../demo-session-repository";
import { SupabaseDemoSessionRepository } from "../supabase-demo-session-repository";

function lookupId(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("base64url");
}

function databaseRow(sessionId: string, storedSessionId = lookupId(sessionId)) {
  const record = createDemoSessionRecord(sessionId, new Date("2026-08-10T16:00:00.000Z"));
  return {
    session_id: storedSessionId,
    generation: record.generation,
    revision: record.revision,
    actions: record.actions,
    clock_origin: record.clockOrigin,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    expires_at: record.expiresAt,
  };
}

describe("RelayPass deployment boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an opaque cookie identifier with hardened production options", () => {
    const sessionId = createOpaqueDemoSessionId();

    expect(isOpaqueDemoSessionId(sessionId)).toBe(true);
    expect(sessionId).toHaveLength(43);
    expect(demoSessionCookieOptions(true)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/demo",
      maxAge: 7_200,
    });
  });

  it("rejects reset, duplicate actions, and unknown fields in durable records", () => {
    const base = createDemoSessionRecord(createOpaqueDemoSessionId());

    expect(
      DemoSessionRecordSchema.safeParse({
        ...base,
        actions: ["request_consent", "request_consent"],
      }).success,
    ).toBe(false);
    expect(
      DemoSessionRecordSchema.safeParse({ ...base, actions: ["reset"] }).success,
    ).toBe(false);
    expect(
      DemoSessionRecordSchema.safeParse({ ...base, browserPolicy: {} }).success,
    ).toBe(false);
  });

  it("uses the current Supabase secret only as an apikey header", async () => {
    const sessionId = createOpaqueDemoSessionId();
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const repository = new SupabaseDemoSessionRepository({
      url: "https://relaypass.supabase.co",
      secretKey: "sb_secret_test_server_only",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await repository.find(sessionId);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(input)).toContain(lookupId(sessionId));
    expect(String(input)).not.toContain(sessionId);
    expect(headers.get("apikey")).toBe("sb_secret_test_server_only");
    expect(headers.has("authorization")).toBe(false);
    expect(init?.cache).toBe("no-store");
  });

  it("stores only a one-way session lookup digest and maps rows back to the bearer", async () => {
    const sessionId = createOpaqueDemoSessionId();
    const record = createDemoSessionRecord(
      sessionId,
      new Date("2026-08-10T16:00:00.000Z"),
    );
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      void _input;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json([{ ...body }]);
    });
    const repository = new SupabaseDemoSessionRepository({
      url: "https://relaypass.supabase.co/",
      secretKey: "sb_secret_test_server_only",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const created = await repository.create(record);

    expect(created).toMatchObject({ created: true, record: { sessionId } });
    const [input, init] = fetchImpl.mock.calls[0]!;
    const stored = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(String(input)).not.toContain(sessionId);
    expect(stored.session_id).toBe(lookupId(sessionId));
    expect(JSON.stringify(stored)).not.toContain(sessionId);
  });

  it("uses the digest, never the bearer, for compare-and-swap filters", async () => {
    const sessionId = createOpaqueDemoSessionId();
    const record = createDemoSessionRecord(
      sessionId,
      new Date("2026-08-10T16:00:00.000Z"),
    );
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      void _input;
      const mutation = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json([
        {
          ...databaseRow(sessionId),
          ...mutation,
        },
      ]);
    });
    const repository = new SupabaseDemoSessionRepository({
      url: "https://relaypass.supabase.co",
      secretKey: "sb_secret_test_server_only",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const committed = await repository.compareAndSwap(sessionId, 0, {
      generation: 0,
      actions: ["request_consent"],
      clockOrigin: record.clockOrigin,
      updatedAt: "2026-08-10T16:01:00.000Z",
      expiresAt: record.expiresAt,
    });

    expect(committed).toMatchObject({ sessionId, revision: 1, actions: ["request_consent"] });
    const [input] = fetchImpl.mock.calls[0]!;
    expect(String(input)).toContain(lookupId(sessionId));
    expect(String(input)).not.toContain(sessionId);
  });

  it("rejects a mismatched storage lookup key and non-origin Supabase URLs", async () => {
    const sessionId = createOpaqueDemoSessionId();
    const fetchImpl = vi.fn(async () => Response.json([databaseRow(sessionId, "A".repeat(43))]));
    const repository = new SupabaseDemoSessionRepository({
      url: "https://relaypass.supabase.co",
      secretKey: "sb_secret_test_server_only",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(repository.find(sessionId)).rejects.toThrow("mismatched lookup key");

    for (const url of [
      "http://relaypass.supabase.co",
      "https://user:password@relaypass.supabase.co",
      "https://relaypass.supabase.co/rest/v1",
      "https://relaypass.supabase.co?project=other",
      "https://relaypass.supabase.co#fragment",
      "not-a-url",
    ]) {
      expect(
        () =>
          new SupabaseDemoSessionRepository({
            url,
            secretKey: "sb_secret_test_server_only",
          }),
      ).toThrow("HTTPS origin");
    }
  });

  it("requires a stable signing secret whenever durable storage is selected", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RELAYPASS_DEMO_STORE", "supabase");
    vi.stubEnv("SUPABASE_URL", "https://relaypass.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_server_only");
    vi.stubEnv("RELAYPASS_DEMO_SIGNING_SECRET", "");
    const { getDemoSessionCoordinator } = await import("../demo-singleton");

    expect(() => getDemoSessionCoordinator()).toThrow(
      "Durable demo sessions require RELAYPASS_DEMO_SIGNING_SECRET",
    );
  });

  it("fails closed in production when durable storage credentials are absent", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RELAYPASS_DEMO_STORE", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("RELAYPASS_DEMO_SIGNING_SECRET", "");
    const { getDemoSessionCoordinator } = await import("../demo-singleton");

    expect(() => getDemoSessionCoordinator()).toThrow(
      "Production demo sessions require SUPABASE_URL and SUPABASE_SECRET_KEY",
    );
  });

  it("rejects an Origin with the right host but the wrong scheme", async () => {
    const { POST } = await import("@/app/api/demo/route");
    const request = new NextRequest("https://relaypass.example/api/demo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "relaypass.example",
        Origin: "http://relaypass.example",
      },
      body: JSON.stringify({ action: "request_consent" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_origin" },
    });
  });
});
