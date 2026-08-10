import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import type { DemoSnapshot } from "../../../../lib/demo/types";
import { DEMO_SESSION_COOKIE } from "../../../../lib/demo/demo-session-cookie";
import { GET, POST } from "../route";

const ENDPOINT = "http://localhost/api/demo";

function request(
  method: "GET" | "POST",
  options: {
    cookie?: string;
    body?: string;
    origin?: string;
    contentType?: string;
    contentLength?: string;
  } = {},
) {
  const headers = new Headers();
  headers.set("host", "localhost");
  if (options.cookie) headers.set("cookie", `${DEMO_SESSION_COOKIE}=${options.cookie}`);
  if (options.origin) headers.set("origin", options.origin);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  if (options.body !== undefined) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return new NextRequest(ENDPOINT, {
    method,
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${DEMO_SESSION_COOKIE}=([^;]+)`).exec(setCookie);
  if (!match?.[1]) throw new Error("Demo response did not set its opaque session cookie");
  return match[1];
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toContain("Cookie");
}

async function post(cookie: string | undefined, action: string) {
  const response = await POST(
    request("POST", {
      ...(cookie ? { cookie } : {}),
      origin: "http://localhost",
      body: JSON.stringify({ action }),
    }),
  );
  return {
    response,
    cookie: sessionCookie(response),
    snapshot: (await response.json()) as DemoSnapshot,
  };
}

describe("/api/demo session reliability", () => {
  it("creates an opaque hardened cookie and private no-store response", async () => {
    const response = await GET(request("GET"));
    const cookie = sessionCookie(response);
    const setCookie = response.headers.get("set-cookie") ?? "";
    const snapshot = (await response.json()) as DemoSnapshot;

    expect(response.status).toBe(200);
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain("Path=/api/demo");
    expect(setCookie).toContain("Max-Age=7200");
    expect(setCookie).toContain("Priority=high");
    expect(snapshot).toMatchObject({
      stage: "passport",
      outcomes: {},
      receipts: [],
      revocation: { rootRevoked: false },
    });
    expect(JSON.stringify(snapshot)).not.toContain(cookie);
    expectPrivateNoStore(response);
  });

  it("keeps two cookie sessions isolated through mutation and reset", async () => {
    const firstGet = await GET(request("GET"));
    const secondGet = await GET(request("GET"));
    const firstCookie = sessionCookie(firstGet);
    const secondCookie = sessionCookie(secondGet);
    expect(secondCookie).not.toBe(firstCookie);

    let first = await post(firstCookie, "request_consent");
    first = await post(first.cookie, "approve");
    first = await post(first.cookie, "derive");
    expect(first.snapshot.stage).toBe("children_active");
    expect(first.snapshot.receipts).toHaveLength(4);

    const secondStillPristine = await GET(request("GET", { cookie: secondCookie }));
    expect((await secondStillPristine.json()) as DemoSnapshot).toMatchObject({
      stage: "passport",
      receipts: [],
      outcomes: {},
      revocation: { rootRevoked: false },
    });

    const firstReset = await post(first.cookie, "reset");
    expect(firstReset.snapshot).toMatchObject({
      stage: "passport",
      receipts: [],
      outcomes: {},
      revocation: { rootRevoked: false },
    });
    const secondAfterReset = await GET(request("GET", { cookie: secondCookie }));
    expect((await secondAfterReset.json()) as DemoSnapshot).toMatchObject({
      stage: "passport",
      receipts: [],
    });
  });

  it("rotates an unknown opaque cookie and preserves the rotated ID on mutation", async () => {
    const unknown = "A".repeat(43);
    const response = await GET(request("GET", { cookie: unknown }));
    const rotated = sessionCookie(response);
    expect(rotated).not.toBe(unknown);

    const consent = await post(rotated, "request_consent");
    expect(consent.cookie).toBe(rotated);
    expect(consent.snapshot).toMatchObject({
      stage: "consent",
      consent: { requested: true, approved: false },
    });
  });

  it("strictly rejects malformed, injected, unsupported, and cross-site mutations", async () => {
    const malformed = await POST(
      request("POST", {
        origin: "http://localhost",
        body: "{not-json",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    expectPrivateNoStore(malformed);

    const injected = await POST(
      request("POST", {
        origin: "http://localhost",
        body: JSON.stringify({
          action: "derive",
          requestedContext: ["profile.home_address"],
          amount: 999_999,
        }),
      }),
    );
    expect(injected.status).toBe(400);
    expect(await injected.json()).toMatchObject({ error: { code: "invalid_request" } });

    const unsupported = await POST(
      request("POST", {
        origin: "http://localhost",
        body: JSON.stringify({ action: "derive_unrestricted_child" }),
      }),
    );
    expect(unsupported.status).toBe(400);

    const crossSite = await POST(
      request("POST", {
        origin: "https://attacker.example",
        body: JSON.stringify({ action: "reset" }),
      }),
    );
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toMatchObject({ error: { code: "invalid_origin" } });
    expectPrivateNoStore(crossSite);
  });

  it("requires a JSON same-origin mutation and enforces declared and actual byte limits", async () => {
    const missingOrigin = await POST(
      request("POST", { body: JSON.stringify({ action: "request_consent" }) }),
    );
    expect(missingOrigin.status).toBe(403);
    await expect(missingOrigin.json()).resolves.toMatchObject({
      error: { code: "invalid_origin" },
    });

    const wrongMediaType = await POST(
      request("POST", {
        origin: "http://localhost",
        contentType: "text/plain",
        body: JSON.stringify({ action: "request_consent" }),
      }),
    );
    expect(wrongMediaType.status).toBe(415);
    await expect(wrongMediaType.json()).resolves.toMatchObject({
      error: { code: "unsupported_media_type" },
    });

    const declaredOversize = await POST(
      request("POST", {
        origin: "http://localhost",
        contentLength: "1025",
        body: JSON.stringify({ action: "request_consent" }),
      }),
    );
    expect(declaredOversize.status).toBe(413);
    await expect(declaredOversize.json()).resolves.toMatchObject({
      error: { code: "request_too_large" },
    });

    const actualOversize = await POST(
      request("POST", {
        origin: "http://localhost",
        body: JSON.stringify({ action: "request_consent", padding: "🛡️".repeat(400) }),
      }),
    );
    expect(actualOversize.status).toBe(413);
    await expect(actualOversize.json()).resolves.toMatchObject({
      error: { code: "request_too_large" },
    });

    for (const response of [missingOrigin, wrongMediaType, declaredOversize, actualOversize]) {
      expectPrivateNoStore(response);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("creates a private session when the first request is a valid POST", async () => {
    const result = await post(undefined, "request_consent");
    expect(result.response.status).toBe(200);
    expect(result.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.snapshot).toMatchObject({
      stage: "consent",
      consent: { requested: true, approved: false },
    });
    expectPrivateNoStore(result.response);
  });

  it("accepts the direct Host origin when Next normalizes its internal URL host", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3012/api/demo", {
        method: "POST",
        headers: {
          Host: "127.0.0.1:3012",
          Origin: "http://127.0.0.1:3012",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "request_consent" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      stage: "consent",
      consent: { requested: true },
    });
  });
});
