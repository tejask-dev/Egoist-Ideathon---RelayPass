import { describe, expect, it } from "vitest";

import { RootPassIssuer } from "../../relaypass";
import {
  DEMO_IDS,
  createDemoRootConsent,
} from "../demo-fixtures";
import { createOpaqueDemoSessionId } from "../demo-session-cookie";
import { DemoSessionCoordinator } from "../demo-session-coordinator";
import {
  InMemoryDemoSessionRepository,
  createDemoSessionRecord,
  type DemoSessionMutation,
  type DemoSessionRecord,
  type DemoSessionRepository,
} from "../demo-session-repository";
import { DeterministicDemoSignerProvider } from "../demo-signer-provider";

const SIGNING_SECRET =
  "relaypass-test-only-deterministic-secret-with-at-least-thirty-two-bytes";
const COORDINATOR_NOW = new Date("2026-08-10T16:00:00.000Z");

const COORDINATED_FLOW = [
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

function mutationFrom(
  record: ReturnType<typeof createDemoSessionRecord>,
  overrides: Partial<{
    generation: number;
    actions: typeof record.actions;
    clockOrigin: string;
    updatedAt: string;
    expiresAt: string;
  }> = {},
) {
  return {
    generation: overrides.generation ?? record.generation,
    actions: overrides.actions ?? record.actions,
    clockOrigin: overrides.clockOrigin ?? record.clockOrigin,
    updatedAt: overrides.updatedAt ?? record.updatedAt,
    expiresAt: overrides.expiresAt ?? record.expiresAt,
  };
}

describe("RelayPass durable demo session primitives", () => {
  it("uses compare-and-swap so only one concurrent writer can commit a revision", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const sessionId = createOpaqueDemoSessionId();
    const original = createDemoSessionRecord(
      sessionId,
      new Date("2026-08-10T16:00:00.000Z"),
    );
    expect((await repository.create(original)).created).toBe(true);

    const contenders = await Promise.all([
      repository.compareAndSwap(
        sessionId,
        0,
        mutationFrom(original, { actions: ["request_consent"] }),
      ),
      repository.compareAndSwap(
        sessionId,
        0,
        mutationFrom(original, { actions: ["approve"] }),
      ),
    ]);

    expect(contenders.filter(Boolean)).toHaveLength(1);
    expect(contenders.filter((record) => record === undefined)).toHaveLength(1);
    const committed = await repository.find(sessionId);
    expect(committed?.revision).toBe(1);
    expect(committed?.actions).toHaveLength(1);
    expect(
      await repository.compareAndSwap(
        sessionId,
        0,
        mutationFrom(original, { actions: ["request_consent"] }),
      ),
    ).toBeUndefined();
  });

  it("advances reset generation atomically and rejects stale pre-reset writes", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const sessionId = createOpaqueDemoSessionId();
    const original = createDemoSessionRecord(
      sessionId,
      new Date("2026-08-10T16:00:00.000Z"),
    );
    await repository.create(original);
    const active = await repository.compareAndSwap(
      sessionId,
      0,
      mutationFrom(original, {
        actions: ["request_consent", "approve", "derive"],
        updatedAt: "2026-08-10T16:01:00.000Z",
      }),
    );
    if (!active) throw new Error("Expected the initial session mutation to commit");

    const resetOrigin = "2026-08-10T16:02:00.000Z";
    const reset = await repository.compareAndSwap(
      sessionId,
      active.revision,
      mutationFrom(original, {
        generation: active.generation + 1,
        actions: [],
        clockOrigin: resetOrigin,
        updatedAt: resetOrigin,
        expiresAt: "2026-08-10T18:02:00.000Z",
      }),
    );

    expect(reset).toMatchObject({
      sessionId,
      generation: 1,
      revision: 2,
      actions: [],
      clockOrigin: resetOrigin,
    });
    expect(
      await repository.compareAndSwap(
        sessionId,
        active.revision,
        mutationFrom(active, {
          actions: [...active.actions, "verify_flight"],
        }),
      ),
    ).toBeUndefined();
    expect(await repository.find(sessionId)).toEqual(reset);
  });

  it("returns defensive copies and never creates a caller-selected unknown session", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const sessionId = createOpaqueDemoSessionId();
    const original = createDemoSessionRecord(sessionId);
    await repository.create(original);

    const found = await repository.find(sessionId);
    if (!found) throw new Error("Expected the created session to be readable");
    found.actions.push("request_consent");

    expect((await repository.find(sessionId))?.actions).toEqual([]);
    expect(await repository.find(createOpaqueDemoSessionId())).toBeUndefined();
  });
});

describe("RelayPass deterministic server-only demo signers", () => {
  it("reconstructs identical keys and pass JWS for one session generation", async () => {
    const provider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const coordinates = { sessionId: createOpaqueDemoSessionId(), generation: 3 };
    const [first, second] = await Promise.all([
      provider.getSigners(coordinates),
      provider.getSigners(coordinates),
    ]);

    expect(second.rootIssuer.publicKey).toEqual(first.rootIssuer.publicKey);
    expect(second.nova.publicKey).toEqual(first.nova.publicKey);
    expect(second.flight.publicKey).toEqual(first.flight.publicKey);
    expect(second.stay.publicKey).toEqual(first.stay.publicKey);
    expect(second.dinner.publicKey).toEqual(first.dinner.publicKey);
    const firstPass = await new RootPassIssuer(
      first.rootIssuer,
      () => DEMO_IDS.rootPass,
    ).issue(createDemoRootConsent(first));
    const secondPass = await new RootPassIssuer(
      second.rootIssuer,
      () => DEMO_IDS.rootPass,
    ).issue(createDemoRootConsent(second));

    expect(secondPass).toEqual(firstPass);
    expect(secondPass.proof.jws).toBe(firstPass.proof.jws);
  });

  it("derives different keys and pass JWS across sessions and reset generations", async () => {
    const provider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const firstSession = createOpaqueDemoSessionId();
    const secondSession = createOpaqueDemoSessionId();
    const [base, otherSession, nextGeneration] = await Promise.all([
      provider.getSigners({ sessionId: firstSession, generation: 0 }),
      provider.getSigners({ sessionId: secondSession, generation: 0 }),
      provider.getSigners({ sessionId: firstSession, generation: 1 }),
    ]);
    const issue = (signers: Awaited<ReturnType<typeof provider.getSigners>>) =>
      new RootPassIssuer(signers.rootIssuer, () => DEMO_IDS.rootPass).issue(
        createDemoRootConsent(signers),
      );
    const [basePass, otherSessionPass, nextGenerationPass] = await Promise.all([
      issue(base),
      issue(otherSession),
      issue(nextGeneration),
    ]);

    expect(otherSession.rootIssuer.publicKey).not.toEqual(base.rootIssuer.publicKey);
    expect(nextGeneration.rootIssuer.publicKey).not.toEqual(base.rootIssuer.publicKey);
    expect(otherSessionPass.proof.jws).not.toBe(basePass.proof.jws);
    expect(nextGenerationPass.proof.jws).not.toBe(basePass.proof.jws);
  });
});

function coordinator(
  repository: DemoSessionRepository,
  signerProvider: DeterministicDemoSignerProvider,
  options: {
    now?: () => Date;
    idFactory?: () => string;
    maxCasAttempts?: number;
  } = {},
) {
  return new DemoSessionCoordinator({
    repository,
    signerProvider,
    now: options.now ?? (() => new Date(COORDINATOR_NOW)),
    ...(options.idFactory ? { idFactory: options.idFactory } : {}),
    ...(options.maxCasAttempts
      ? { maxCasAttempts: options.maxCasAttempts }
      : {}),
  });
}

describe("RelayPass cold session coordination", () => {
  it("reconstructs an identical snapshot on a fresh coordinator after every action", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const initialized = await coordinator(repository, signerProvider).initialize();
    const sessionId = initialized.sessionId;
    let expectedRevision = 0;

    for (const action of COORDINATED_FLOW) {
      const live = await coordinator(repository, signerProvider).run(sessionId, action);
      expectedRevision += 1;
      expect(live.record.revision).toBe(expectedRevision);
      expect(live.record.actions.at(-1)).toBe(action);

      const cold = await coordinator(repository, signerProvider).initialize(sessionId);
      expect(cold.created).toBe(false);
      expect(cold.rotated).toBe(false);
      expect(cold.record).toEqual(live.record);
      expect(cold.snapshot).toEqual(live.snapshot);
    }

    const final = await coordinator(repository, signerProvider).initialize(sessionId);
    expect(final.snapshot).toMatchObject({
      stage: "retry_refused",
      revocation: { rootRevoked: true },
      outcomes: {
        flight: { decision: { code: "allowed" }, sideEffectPerformed: true },
        homeAddress: {
          decision: { code: "unauthorized_context", disclosedContext: [] },
          sharedFields: 0,
          passportValueFetchCalled: false,
        },
        hotel: {
          decision: { code: "constraint_violation" },
          purchaseMade: false,
        },
        dinner: {
          decision: { code: "allowed" },
          diagnosisInPass: false,
          diagnosisDisclosed: false,
        },
        revokedRetry: {
          decision: { code: "relay_pass_revoked", semanticStatus: 401 },
          sideEffectPerformed: false,
        },
      },
    });
    expect(final.snapshot.receipts).toHaveLength(10);
    expectNoSessionSecrets(final.snapshot);
  });

  it("keeps two browser sessions isolated across action, revocation, and reset", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const service = coordinator(repository, signerProvider);
    const first = await service.initialize();
    const second = await service.initialize();
    expect(second.sessionId).not.toBe(first.sessionId);

    for (const action of [
      "request_consent",
      "approve",
      "derive",
      "verify_flight",
    ] as const) {
      await coordinator(repository, signerProvider).run(first.sessionId, action);
    }
    const untouched = await coordinator(repository, signerProvider).initialize(
      second.sessionId,
    );
    expect(untouched.snapshot).toMatchObject({
      stage: "passport",
      outcomes: {},
      receipts: [],
      revocation: { rootRevoked: false },
    });

    for (const action of ["request_consent", "approve", "derive"] as const) {
      await coordinator(repository, signerProvider).run(second.sessionId, action);
    }
    await coordinator(repository, signerProvider).run(first.sessionId, "revoke");
    const firstRevoked = await coordinator(repository, signerProvider).initialize(
      first.sessionId,
    );
    const secondActive = await coordinator(repository, signerProvider).initialize(
      second.sessionId,
    );
    expect(firstRevoked.snapshot.revocation.rootRevoked).toBe(true);
    expect(secondActive.snapshot.revocation.rootRevoked).toBe(false);
    expect(
      secondActive.snapshot.relayTree.nodes.find(({ id }) => id === "nova")?.status,
    ).toBe("active");

    const firstReset = await coordinator(repository, signerProvider).run(
      first.sessionId,
      "reset",
    );
    expect(firstReset.sessionId).toBe(first.sessionId);
    expect(firstReset.record.generation).toBe(1);
    expect(firstReset.record.actions).toEqual([]);
    expect(firstReset.snapshot.stage).toBe("passport");
    const secondAfterReset = await coordinator(repository, signerProvider).initialize(
      second.sessionId,
    );
    expect(secondAfterReset.record).toEqual(secondActive.record);
    expect(secondAfterReset.snapshot).toEqual(secondActive.snapshot);
  });

  it("deduplicates the same concurrent action across coordinator instances", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const initialized = await coordinator(repository, signerProvider).initialize();
    await coordinator(repository, signerProvider).run(
      initialized.sessionId,
      "request_consent",
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        coordinator(repository, signerProvider).run(initialized.sessionId, "approve"),
      ),
    );
    const stored = await repository.find(initialized.sessionId);

    expect(stored?.actions).toEqual(["request_consent", "approve"]);
    expect(stored?.revision).toBe(2);
    expect(results.every(({ record }) => record.revision === 2)).toBe(true);
    expect(results.every(({ snapshot }) => snapshot.consent.approved)).toBe(true);
    expect(results.every(({ snapshot }) => snapshot.receipts.length === 1)).toBe(true);
  });

  it("rotates unknown and expired session IDs instead of accepting caller-selected IDs", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const unknown = createOpaqueDemoSessionId();
    const unknownReplacement = createOpaqueDemoSessionId();
    const unknownResult = await coordinator(repository, signerProvider, {
      idFactory: () => unknownReplacement,
    }).initialize(unknown);

    expect(unknownResult).toMatchObject({
      sessionId: unknownReplacement,
      created: true,
      rotated: true,
      snapshot: { stage: "passport", receipts: [] },
    });
    expect(await repository.find(unknown)).toBeUndefined();

    const expiredId = createOpaqueDemoSessionId();
    const expired = createDemoSessionRecord(
      expiredId,
      new Date("2026-08-10T12:00:00.000Z"),
    );
    await repository.create(expired);
    const expiredReplacement = createOpaqueDemoSessionId();
    const expiredResult = await coordinator(repository, signerProvider, {
      idFactory: () => expiredReplacement,
    }).initialize(expiredId);

    expect(expiredResult).toMatchObject({
      sessionId: expiredReplacement,
      created: true,
      rotated: true,
      snapshot: { stage: "passport", receipts: [] },
    });
    expect((await repository.find(expiredId))?.sessionId).toBe(expiredId);
  });

  it("does not persist post-revoke hero actions as misleading outcomes", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const initialized = await coordinator(repository, signerProvider).initialize();
    for (const action of ["request_consent", "approve", "derive", "revoke"] as const) {
      await coordinator(repository, signerProvider).run(initialized.sessionId, action);
    }
    const before = await repository.find(initialized.sessionId);

    for (const action of [
      "verify_flight",
      "forbidden_context",
      "over_budget_hotel",
      "dinner_disclosure",
    ] as const) {
      const refused = await coordinator(repository, signerProvider).run(
        initialized.sessionId,
        action,
      );
      expect(refused.snapshot.stage).toBe("root_revoked");
      expect(refused.snapshot.lastError?.code).toBe("relay_pass_revoked");
      expect(refused.snapshot.outcomes).toEqual({});
      expect(refused.record).toEqual(before);
    }

    expect(await repository.find(initialized.sessionId)).toEqual(before);
  });

  it("persists immediate root revocation without inventing unissued children", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const initialized = await coordinator(repository, signerProvider).initialize();
    for (const action of ["request_consent", "approve"] as const) {
      await coordinator(repository, signerProvider).run(initialized.sessionId, action);
    }

    const revoked = await coordinator(repository, signerProvider).run(
      initialized.sessionId,
      "revoke",
    );
    expect(revoked.record.actions).toEqual([
      "request_consent",
      "approve",
      "revoke",
    ]);
    expect(revoked.snapshot).toMatchObject({
      stage: "root_revoked",
      revocation: { rootRevoked: true },
    });
    expect(
      revoked.snapshot.relayTree.nodes.find(({ id }) => id === "nova")?.status,
    ).toBe("revoked");
    for (const id of ["flight", "stay", "dinner"] as const) {
      expect(
        revoked.snapshot.relayTree.nodes.find((node) => node.id === id)?.status,
      ).toBe("not_issued");
    }

    const cold = await coordinator(repository, signerProvider).initialize(
      initialized.sessionId,
    );
    expect(cold.record).toEqual(revoked.record);
    expect(cold.snapshot).toEqual(revoked.snapshot);

    const retry = await coordinator(repository, signerProvider).run(
      initialized.sessionId,
      "retry_revoked_flight",
    );
    expect(retry.record).toEqual(revoked.record);
    expect(retry.snapshot.stage).toBe("root_revoked");
    expect(retry.snapshot.lastError).toMatchObject({
      code: "demo_precondition_failed",
      message: "Derive FlightAgent before retrying its revoked pass",
    });
    expect(retry.snapshot.outcomes.revokedRetry).toBeUndefined();
  });

  it("returns current revoked state for a delayed duplicate that already committed", async () => {
    const repository = new InMemoryDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const initialized = await coordinator(repository, signerProvider).initialize();
    for (const action of ["request_consent", "approve", "derive", "revoke"] as const) {
      await coordinator(repository, signerProvider).run(initialized.sessionId, action);
    }
    const before = await repository.find(initialized.sessionId);

    const duplicate = await coordinator(repository, signerProvider).run(
      initialized.sessionId,
      "approve",
    );

    expect(duplicate.record).toEqual(before);
    expect(duplicate.snapshot).toMatchObject({
      stage: "root_revoked",
      revocation: { rootRevoked: true },
    });
    expect(duplicate.snapshot.lastError).toBeUndefined();
    expect(await repository.find(initialized.sessionId)).toEqual(before);
  });
});

function expectNoSessionSecrets(candidate: unknown) {
  const encoded = JSON.stringify(candidate);
  expect(encoded).not.toContain(SIGNING_SECRET);
  expect(encoded).not.toContain('"privateKey"');
  expect(encoded).not.toContain('"d":');
  expect(encoded).not.toContain("18 Sensitive Street");
  expect(encoded).not.toContain("Private diagnosis");
}

class PausingDemoSessionRepository implements DemoSessionRepository {
  private readonly inner = new InMemoryDemoSessionRepository();
  private pauseAction = false;
  private actionEnteredResolve!: () => void;
  private releaseActionResolve!: () => void;
  private actionEnteredPromise = Promise.resolve();
  private releaseActionPromise = Promise.resolve();

  pauseNextRequestConsentCommit() {
    this.pauseAction = true;
    this.actionEnteredPromise = new Promise<void>((resolve) => {
      this.actionEnteredResolve = resolve;
    });
    this.releaseActionPromise = new Promise<void>((resolve) => {
      this.releaseActionResolve = resolve;
    });
  }

  waitForPausedAction() {
    return this.actionEnteredPromise;
  }

  releasePausedAction() {
    this.releaseActionResolve();
  }

  find(sessionId: string) {
    return this.inner.find(sessionId);
  }

  create(record: DemoSessionRecord) {
    return this.inner.create(record);
  }

  async compareAndSwap(
    sessionId: string,
    expectedRevision: number,
    mutation: DemoSessionMutation,
  ) {
    if (
      this.pauseAction &&
      mutation.generation === 0 &&
      mutation.actions.length === 1 &&
      mutation.actions[0] === "request_consent"
    ) {
      this.pauseAction = false;
      this.actionEnteredResolve();
      await this.releaseActionPromise;
    }
    return this.inner.compareAndSwap(sessionId, expectedRevision, mutation);
  }
}

describe("RelayPass reset concurrency", () => {
  it("does not let an in-flight pre-reset action repopulate the new generation", async () => {
    const repository = new PausingDemoSessionRepository();
    const signerProvider = new DeterministicDemoSignerProvider(SIGNING_SECRET);
    const initialized = await coordinator(repository, signerProvider).initialize();
    repository.pauseNextRequestConsentCommit();

    const staleAction = coordinator(repository, signerProvider).run(
      initialized.sessionId,
      "request_consent",
    );
    await repository.waitForPausedAction();
    const reset = await coordinator(repository, signerProvider).run(
      initialized.sessionId,
      "reset",
    );
    repository.releasePausedAction();
    const staleResult = await staleAction;
    const final = await coordinator(repository, signerProvider).initialize(
      initialized.sessionId,
    );

    expect(reset.record).toMatchObject({ generation: 1, revision: 1, actions: [] });
    expect(staleResult.record.generation).toBe(1);
    expect(final.record).toMatchObject({ generation: 1, revision: 1, actions: [] });
    expect(final.snapshot).toMatchObject({
      stage: "passport",
      consent: { requested: false, approved: false },
      receipts: [],
      outcomes: {},
      revocation: { rootRevoked: false },
    });
  });
});
