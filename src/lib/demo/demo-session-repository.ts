import { z } from "zod";

export const PERSISTED_DEMO_ACTIONS = [
  "request_consent",
  "approve",
  "derive",
  "verify_flight",
  "forbidden_context",
  "over_budget_hotel",
  "dinner_disclosure",
  "revoke",
  "retry_revoked_flight",
] as const;

export const PersistedDemoActionSchema = z.enum(PERSISTED_DEMO_ACTIONS);
export type PersistedDemoAction = z.infer<typeof PersistedDemoActionSchema>;

const OpaqueSessionIdSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/, "Session ID must be base64url encoded");

export const DemoSessionRecordSchema = z
  .object({
    sessionId: OpaqueSessionIdSchema,
    generation: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    actions: z.array(PersistedDemoActionSchema).max(PERSISTED_DEMO_ACTIONS.length),
    clockOrigin: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((record, context) => {
    if (new Set(record.actions).size !== record.actions.length) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "Persisted demo actions must be unique",
      });
    }
    if (Date.parse(record.expiresAt) <= Date.parse(record.clockOrigin)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Demo session expiry must be later than its clock origin",
      });
    }
  });

export type DemoSessionRecord = z.infer<typeof DemoSessionRecordSchema>;

export const DemoSessionMutationSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    actions: z.array(PersistedDemoActionSchema).max(PERSISTED_DEMO_ACTIONS.length),
    clockOrigin: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((mutation, context) => {
    if (new Set(mutation.actions).size !== mutation.actions.length) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "Persisted demo actions must be unique",
      });
    }
    if (Date.parse(mutation.expiresAt) <= Date.parse(mutation.clockOrigin)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Demo session expiry must be later than its clock origin",
      });
    }
  });

export type DemoSessionMutation = z.infer<typeof DemoSessionMutationSchema>;

export type DemoSessionCreateResult = {
  created: boolean;
  record: DemoSessionRecord;
};

export interface DemoSessionRepository {
  find(sessionId: string): Promise<DemoSessionRecord | undefined>;
  create(record: DemoSessionRecord): Promise<DemoSessionCreateResult>;
  compareAndSwap(
    sessionId: string,
    expectedRevision: number,
    mutation: DemoSessionMutation,
  ): Promise<DemoSessionRecord | undefined>;
}

function copyRecord(record: DemoSessionRecord): DemoSessionRecord {
  return DemoSessionRecordSchema.parse(structuredClone(record));
}

export function createDemoSessionRecord(
  sessionId: string,
  now: Date = new Date(),
): DemoSessionRecord {
  const clockOrigin = now.toISOString();
  return DemoSessionRecordSchema.parse({
    sessionId,
    generation: 0,
    revision: 0,
    actions: [],
    clockOrigin,
    createdAt: clockOrigin,
    updatedAt: clockOrigin,
    expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000).toISOString(),
  });
}

export class InMemoryDemoSessionRepository implements DemoSessionRepository {
  private readonly sessions = new Map<string, DemoSessionRecord>();

  async find(sessionId: string): Promise<DemoSessionRecord | undefined> {
    const record = this.sessions.get(sessionId);
    return record ? copyRecord(record) : undefined;
  }

  async create(candidate: DemoSessionRecord): Promise<DemoSessionCreateResult> {
    const record = DemoSessionRecordSchema.parse(candidate);
    const existing = this.sessions.get(record.sessionId);
    if (existing) return { created: false, record: copyRecord(existing) };

    this.sessions.set(record.sessionId, copyRecord(record));
    return { created: true, record: copyRecord(record) };
  }

  async compareAndSwap(
    sessionId: string,
    expectedRevision: number,
    candidate: DemoSessionMutation,
  ): Promise<DemoSessionRecord | undefined> {
    const current = this.sessions.get(sessionId);
    if (!current || current.revision !== expectedRevision) return undefined;

    const mutation = DemoSessionMutationSchema.parse(candidate);
    const next = DemoSessionRecordSchema.parse({
      ...current,
      ...mutation,
      revision: expectedRevision + 1,
    });
    this.sessions.set(sessionId, copyRecord(next));
    return copyRecord(next);
  }
}
