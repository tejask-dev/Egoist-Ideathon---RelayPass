import { DemoRuntime } from "./demo-runtime";
import { createOpaqueDemoSessionId, isOpaqueDemoSessionId } from "./demo-session-cookie";
import {
  DemoSessionRecordSchema,
  PersistedDemoActionSchema,
  createDemoSessionRecord,
  type DemoSessionRecord,
  type DemoSessionRepository,
  type PersistedDemoAction,
} from "./demo-session-repository";
import type { DemoSignerProvider } from "./demo-signer-provider";
import type { DemoAction, DemoSnapshot } from "./types";

export class DemoSessionConflictError extends Error {
  constructor() {
    super("The demo session changed concurrently; retry the request");
    this.name = "DemoSessionConflictError";
  }
}

export class DemoSessionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSessionIntegrityError";
  }
}

export type DemoSessionCoordinatorResult = {
  sessionId: string;
  record: DemoSessionRecord;
  snapshot: DemoSnapshot;
  created: boolean;
  rotated: boolean;
};

export type DemoSessionCoordinatorOptions = {
  repository: DemoSessionRepository;
  signerProvider: DemoSignerProvider;
  now?: () => Date;
  idFactory?: () => string;
  maxCasAttempts?: number;
};

function assertExpectedDemoActionOutcome(
  action: PersistedDemoAction,
  snapshot: DemoSnapshot,
): void {
  if (snapshot.lastError) {
    throw new DemoSessionIntegrityError(
      `Persisted action ${action} replayed with ${snapshot.lastError.code}`,
    );
  }

  const node = (id: "nova" | "flight" | "stay" | "dinner") =>
    snapshot.relayTree.nodes.find((candidate) => candidate.id === id);
  let valid = false;

  switch (action) {
    case "request_consent":
      valid = snapshot.consent.requested;
      break;
    case "approve":
      valid =
        snapshot.consent.approved &&
        node("nova")?.technicalProof?.signatureVerified === true;
      break;
    case "derive":
      valid = (["flight", "stay", "dinner"] as const).every(
        (id) =>
          node(id)?.status === "active" &&
          node(id)?.technicalProof?.chainVerified === true,
      );
      break;
    case "verify_flight":
      valid =
        snapshot.outcomes.flight?.decision.code === "allowed" &&
        snapshot.outcomes.flight.decision.allowed === true &&
        snapshot.outcomes.flight.sideEffectPerformed === true &&
        Boolean(snapshot.outcomes.flight.booking);
      break;
    case "forbidden_context":
      valid =
        snapshot.outcomes.homeAddress?.decision.code === "unauthorized_context" &&
        snapshot.outcomes.homeAddress.decision.allowed === false &&
        snapshot.outcomes.homeAddress.sharedFields === 0 &&
        snapshot.outcomes.homeAddress.passportValueFetchCalled === false;
      break;
    case "over_budget_hotel":
      valid =
        snapshot.outcomes.hotel?.decision.code === "constraint_violation" &&
        snapshot.outcomes.hotel.decision.allowed === false &&
        snapshot.outcomes.hotel.purchaseMade === false;
      break;
    case "dinner_disclosure":
      valid =
        snapshot.outcomes.dinner?.decision.code === "allowed" &&
        snapshot.outcomes.dinner.decision.allowed === true &&
        snapshot.outcomes.dinner.requiredConstraint === true &&
        snapshot.outcomes.dinner.diagnosisInPass === false &&
        snapshot.outcomes.dinner.diagnosisDisclosed === false;
      break;
    case "revoke":
      valid =
        snapshot.revocation.rootRevoked &&
        node("nova")?.status === "revoked" &&
        (["flight", "stay", "dinner"] as const).every(
          (id) =>
            node(id)?.status === "invalid" || node(id)?.status === "not_issued",
        );
      break;
    case "retry_revoked_flight":
      valid =
        snapshot.outcomes.revokedRetry?.decision.code === "relay_pass_revoked" &&
        snapshot.outcomes.revokedRetry.decision.semanticStatus === 401 &&
        snapshot.outcomes.revokedRetry.sideEffectPerformed === false;
      break;
  }

  if (!valid) {
    throw new DemoSessionIntegrityError(
      `Persisted action ${action} did not reproduce its expected deterministic outcome`,
    );
  }
}

export class DemoSessionCoordinator {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly maxCasAttempts: number;

  constructor(private readonly options: DemoSessionCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? createOpaqueDemoSessionId;
    this.maxCasAttempts = options.maxCasAttempts ?? 3;
  }

  async initialize(presentedSessionId?: string): Promise<DemoSessionCoordinatorResult> {
    const loaded = await this.loadOrCreate(presentedSessionId);
    const runtime = await this.rehydrate(loaded.record);
    return {
      ...loaded,
      snapshot: await runtime.initializeDemo(),
    };
  }

  async run(
    presentedSessionId: string | undefined,
    action: DemoAction,
  ): Promise<DemoSessionCoordinatorResult> {
    if (action === "reset") return this.reset(presentedSessionId);

    const parsedAction = PersistedDemoActionSchema.parse(action);
    let loaded = await this.loadOrCreate(presentedSessionId);

    for (let attempt = 0; attempt < this.maxCasAttempts; attempt += 1) {
      const runtime = await this.rehydrate(loaded.record);

      // A delayed duplicate may arrive after later actions (including revoke)
      // have already committed. Return the reconstructed current state instead
      // of rerunning an older action against that newer authority state.
      if (loaded.record.actions.includes(parsedAction)) {
        return {
          ...loaded,
          snapshot: await runtime.initializeDemo(),
        };
      }

      const snapshot = await runtime.runDemoAction(parsedAction);
      if (snapshot.lastError) {
        return { ...loaded, snapshot };
      }
      assertExpectedDemoActionOutcome(parsedAction, snapshot);

      if (loaded.record.actions.includes(parsedAction)) {
        return { ...loaded, snapshot };
      }

      const updatedAt = this.now().toISOString();
      const committed = await this.options.repository.compareAndSwap(
        loaded.record.sessionId,
        loaded.record.revision,
        {
          generation: loaded.record.generation,
          actions: [...loaded.record.actions, parsedAction],
          clockOrigin: loaded.record.clockOrigin,
          updatedAt,
          expiresAt: loaded.record.expiresAt,
        },
      );
      if (committed) {
        return { ...loaded, record: committed, snapshot };
      }

      const current = await this.options.repository.find(loaded.record.sessionId);
      if (!current || this.isExpired(current)) {
        loaded = await this.loadOrCreate(undefined);
      } else if (current.generation !== loaded.record.generation) {
        const trustedCurrent = DemoSessionRecordSchema.parse(current);
        const currentRuntime = await this.rehydrate(trustedCurrent);
        return {
          ...loaded,
          record: trustedCurrent,
          snapshot: await currentRuntime.initializeDemo(),
        };
      } else {
        loaded = { ...loaded, record: DemoSessionRecordSchema.parse(current) };
      }
    }

    throw new DemoSessionConflictError();
  }

  private async reset(
    presentedSessionId: string | undefined,
  ): Promise<DemoSessionCoordinatorResult> {
    let loaded = await this.loadOrCreate(presentedSessionId);
    const startingGeneration = loaded.record.generation;

    for (let attempt = 0; attempt < this.maxCasAttempts; attempt += 1) {
      const resetAt = this.now();
      const resetOrigin = resetAt.toISOString();
      const committed = await this.options.repository.compareAndSwap(
        loaded.record.sessionId,
        loaded.record.revision,
        {
          generation: loaded.record.generation + 1,
          actions: [],
          clockOrigin: resetOrigin,
          updatedAt: resetOrigin,
          expiresAt: new Date(resetAt.getTime() + 2 * 60 * 60 * 1_000).toISOString(),
        },
      );
      if (committed) {
        const runtime = await this.rehydrate(committed);
        return {
          ...loaded,
          record: committed,
          snapshot: await runtime.initializeDemo(),
        };
      }

      const current = await this.options.repository.find(loaded.record.sessionId);
      if (!current || this.isExpired(current)) {
        loaded = await this.loadOrCreate(undefined);
      } else if (current.generation > startingGeneration && current.actions.length === 0) {
        const runtime = await this.rehydrate(current);
        return {
          ...loaded,
          record: current,
          snapshot: await runtime.initializeDemo(),
        };
      } else {
        loaded = { ...loaded, record: DemoSessionRecordSchema.parse(current) };
      }
    }

    throw new DemoSessionConflictError();
  }

  private async rehydrate(record: DemoSessionRecord): Promise<DemoRuntime> {
    const trusted = DemoSessionRecordSchema.parse(record);
    const signers = await this.options.signerProvider.getSigners({
      sessionId: trusted.sessionId,
      generation: trusted.generation,
    });
    const runtime = await DemoRuntime.create({
      signers,
      clockOrigin: trusted.clockOrigin,
    });

    for (const action of trusted.actions) {
      const snapshot = await runtime.runDemoAction(action);
      assertExpectedDemoActionOutcome(action, snapshot);
    }
    return runtime;
  }

  private async loadOrCreate(
    presentedSessionId?: string,
  ): Promise<Omit<DemoSessionCoordinatorResult, "snapshot">> {
    if (isOpaqueDemoSessionId(presentedSessionId)) {
      const existing = await this.options.repository.find(presentedSessionId);
      if (existing && !this.isExpired(existing)) {
        return {
          sessionId: existing.sessionId,
          record: DemoSessionRecordSchema.parse(existing),
          created: false,
          rotated: false,
        };
      }
    }

    for (let attempt = 0; attempt < this.maxCasAttempts; attempt += 1) {
      const sessionId = this.idFactory();
      if (!isOpaqueDemoSessionId(sessionId)) {
        throw new DemoSessionIntegrityError("Demo session ID factory returned an invalid ID");
      }
      const created = await this.options.repository.create(
        createDemoSessionRecord(sessionId, this.now()),
      );
      if (created.created) {
        return {
          sessionId,
          record: created.record,
          created: true,
          rotated: Boolean(presentedSessionId),
        };
      }
    }

    throw new DemoSessionConflictError();
  }

  private isExpired(record: DemoSessionRecord): boolean {
    return Date.parse(record.expiresAt) <= this.now().getTime();
  }
}
