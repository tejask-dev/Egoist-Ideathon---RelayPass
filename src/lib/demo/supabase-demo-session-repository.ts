import { createHash } from "node:crypto";

import { z } from "zod";

import { isOpaqueDemoSessionId } from "./demo-session-cookie";
import {
  DemoSessionMutationSchema,
  DemoSessionRecordSchema,
  type DemoSessionCreateResult,
  type DemoSessionMutation,
  type DemoSessionRecord,
  type DemoSessionRepository,
} from "./demo-session-repository";

const TABLE = "relaypass_demo_sessions";

const DatabaseRecordSchema = z
  .object({
    session_id: z.string(),
    generation: z.number(),
    revision: z.number(),
    actions: z.unknown(),
    clock_origin: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    expires_at: z.string(),
  })
  .strict();

export class DemoSessionStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSessionStorageError";
  }
}

export type SupabaseDemoSessionRepositoryOptions = {
  url: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
};

function storageSessionId(sessionId: string): string {
  if (!isOpaqueDemoSessionId(sessionId)) {
    throw new DemoSessionStorageError("Demo session lookup ID is invalid");
  }
  return createHash("sha256").update(sessionId, "utf8").digest("base64url");
}

function fromDatabase(candidate: unknown, sessionId: string): DemoSessionRecord {
  try {
    const row = DatabaseRecordSchema.parse(candidate);
    if (row.session_id !== storageSessionId(sessionId)) {
      throw new DemoSessionStorageError(
        "Durable demo session storage returned a mismatched lookup key",
      );
    }
    return DemoSessionRecordSchema.parse({
      sessionId,
      generation: row.generation,
      revision: row.revision,
      actions: row.actions,
      clockOrigin: row.clock_origin,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    });
  } catch (error) {
    if (error instanceof DemoSessionStorageError) throw error;
    throw new DemoSessionStorageError("Durable demo session storage returned an invalid row");
  }
}

function toDatabase(record: DemoSessionRecord) {
  return {
    session_id: storageSessionId(record.sessionId),
    generation: record.generation,
    revision: record.revision,
    actions: record.actions,
    clock_origin: record.clockOrigin,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    expires_at: record.expiresAt,
  };
}

export class SupabaseDemoSessionRepository implements DemoSessionRepository {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SupabaseDemoSessionRepositoryOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    try {
      const parsed = new URL(options.url);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error("invalid Supabase origin");
      }
      this.baseUrl = parsed.origin;
    } catch {
      throw new DemoSessionStorageError(
        "SUPABASE_URL must be an HTTPS origin without credentials, path, query, or fragment",
      );
    }
    if (!options.secretKey.startsWith("sb_secret_")) {
      throw new DemoSessionStorageError(
        "SUPABASE_SECRET_KEY must be a current server-only sb_secret key",
      );
    }
  }

  async find(sessionId: string): Promise<DemoSessionRecord | undefined> {
    const lookupId = storageSessionId(sessionId);
    const rows = await this.request(
      `/${TABLE}?session_id=eq.${encodeURIComponent(lookupId)}&select=${this.selectColumns()}`,
      { method: "GET" },
    );
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    if (rows.length !== 1) {
      throw new DemoSessionStorageError("Demo session lookup returned an invalid row count");
    }
    return fromDatabase(rows[0], sessionId);
  }

  async create(candidate: DemoSessionRecord): Promise<DemoSessionCreateResult> {
    const record = DemoSessionRecordSchema.parse(candidate);
    const rows = await this.request(`/${TABLE}?select=${this.selectColumns()}`, {
      method: "POST",
      headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify(toDatabase(record)),
    });
    if (Array.isArray(rows) && rows.length === 1) {
      return { created: true, record: fromDatabase(rows[0], record.sessionId) };
    }

    const existing = await this.find(record.sessionId);
    if (!existing) {
      throw new DemoSessionStorageError("Demo session create did not persist a row");
    }
    return { created: false, record: existing };
  }

  async compareAndSwap(
    sessionId: string,
    expectedRevision: number,
    candidate: DemoSessionMutation,
  ): Promise<DemoSessionRecord | undefined> {
    const mutation = DemoSessionMutationSchema.parse(candidate);
    const lookupId = storageSessionId(sessionId);
    const rows = await this.request(
      `/${TABLE}?session_id=eq.${encodeURIComponent(lookupId)}` +
        `&revision=eq.${expectedRevision}&select=${this.selectColumns()}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          generation: mutation.generation,
          revision: expectedRevision + 1,
          actions: mutation.actions,
          clock_origin: mutation.clockOrigin,
          updated_at: mutation.updatedAt,
          expires_at: mutation.expiresAt,
        }),
      },
    );
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    if (rows.length !== 1) {
      throw new DemoSessionStorageError("Demo session CAS returned an invalid row count");
    }
    return fromDatabase(rows[0], sessionId);
  }

  private selectColumns(): string {
    return [
      "session_id",
      "generation",
      "revision",
      "actions",
      "clock_origin",
      "created_at",
      "updated_at",
      "expires_at",
    ].join(",");
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/rest/v1${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
        headers: {
          apikey: this.options.secretKey,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch {
      throw new DemoSessionStorageError("Durable demo session storage is unavailable");
    }

    if (!response.ok) {
      throw new DemoSessionStorageError(
        `Durable demo session storage returned HTTP ${response.status}`,
      );
    }
    if (response.status === 204) return [];

    try {
      return await response.json();
    } catch {
      throw new DemoSessionStorageError("Durable demo session storage returned invalid JSON");
    }
  }
}
