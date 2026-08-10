import { type NextRequest, NextResponse } from "next/server";

import { DemoActionBodySchema } from "@/lib/demo/demo-action-schema";
import {
  DemoSessionConflictError,
  type DemoSessionCoordinatorResult,
} from "@/lib/demo/demo-session-coordinator";
import {
  DEMO_SESSION_COOKIE,
  demoSessionCookieOptions,
} from "@/lib/demo/demo-session-cookie";
import {
  DemoDeploymentConfigurationError,
  getDemoSessionCoordinator,
} from "@/lib/demo/demo-singleton";
import { DemoSessionStorageError } from "@/lib/demo/supabase-demo-session-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DEMO_ACTION_BODY_BYTES = 1_024;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

function snapshotResponse(result: DemoSessionCoordinatorResult): NextResponse {
  const response = NextResponse.json(result.snapshot, {
    headers: PRIVATE_NO_STORE_HEADERS,
  });
  response.cookies.set(
    DEMO_SESSION_COOKIE,
    result.sessionId,
    demoSessionCookieOptions(),
  );
  return response;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryAfter?: number,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        ...PRIVATE_NO_STORE_HEADERS,
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      },
    },
  );
}

function sessionId(request: NextRequest): string | undefined {
  return request.cookies.get(DEMO_SESSION_COOKIE)?.value;
}

function isSameRequestOrigin(request: NextRequest, candidate: string): boolean {
  const host = request.headers.get("host");
  if (!host) return false;

  try {
    const origin = new URL(candidate);
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return false;
    }
    const requestOrigin = new URL(`${request.nextUrl.protocol}//${host}`).origin;
    return origin.origin === requestOrigin;
  } catch {
    return false;
  }
}

class DemoRequestTooLargeError extends Error {}

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("missing JSON body");

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_DEMO_ACTION_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new DemoRequestTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function deploymentError(error: unknown): NextResponse | undefined {
  if (
    error instanceof DemoDeploymentConfigurationError ||
    error instanceof DemoSessionStorageError
  ) {
    return errorResponse(
      503,
      "demo_storage_unavailable",
      "RelayPass could not establish durable private demo state. Try again shortly.",
      3,
    );
  }
  if (error instanceof DemoSessionConflictError) {
    return errorResponse(
      409,
      "demo_session_conflict",
      "This demo session changed concurrently. Retry the action.",
    );
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const result = await getDemoSessionCoordinator().initialize(sessionId(request));
    return snapshotResponse(result);
  } catch (error) {
    return (
      deploymentError(error) ??
      errorResponse(
        500,
        "demo_initialization_failed",
        "RelayPass could not initialize the deterministic demo safely.",
      )
    );
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return errorResponse(403, "invalid_origin", "Demo mutations require a same-origin request.");
  }
  if (!isSameRequestOrigin(request, origin)) {
    return errorResponse(403, "invalid_origin", "Cross-site demo mutations are refused.");
  }

  const contentType = request.headers.get("content-type");
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Demo mutations require an application/json body.",
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) {
      return errorResponse(400, "invalid_request", "Content-Length must be a byte count.");
    }
    if (Number(declaredLength) > MAX_DEMO_ACTION_BODY_BYTES) {
      return errorResponse(
        413,
        "request_too_large",
        "Demo action requests may not exceed 1024 bytes.",
      );
    }
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof DemoRequestTooLargeError) {
      return errorResponse(
        413,
        "request_too_large",
        "Demo action requests may not exceed 1024 bytes.",
      );
    }
    return errorResponse(400, "invalid_request", "Expected a JSON demo action.");
  }

  const parsed = DemoActionBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid_request",
      "The requested demo action is not supported.",
    );
  }

  try {
    const result = await getDemoSessionCoordinator().run(
      sessionId(request),
      parsed.data.action,
    );
    return snapshotResponse(result);
  } catch (error) {
    return (
      deploymentError(error) ??
      errorResponse(
        500,
        "demo_action_failed",
        "The demo action failed safely. Reset the demo and try again.",
      )
    );
  }
}
