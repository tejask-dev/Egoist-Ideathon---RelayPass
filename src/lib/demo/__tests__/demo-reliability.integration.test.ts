import { describe, expect, it } from "vitest";

import type { DemoAction } from "../types";
import { DemoRuntime } from "../demo-runtime";

const COMPLETE_FLOW: readonly DemoAction[] = [
  "request_consent",
  "approve",
  "derive",
  "verify_flight",
  "forbidden_context",
  "over_budget_hotel",
  "dinner_disclosure",
  "revoke",
  "retry_revoked_flight",
];

const EXPECTED_RECEIPT_EVENTS = [
  "pass_issued",
  "pass_derived",
  "pass_derived",
  "pass_derived",
  "action_allowed",
  "context_refused",
  "action_refused",
  "context_read",
  "pass_revoked",
  "action_refused",
] as const;

async function run(runtime: DemoRuntime, actions: readonly DemoAction[]) {
  let snapshot = await runtime.initializeDemo();
  for (const action of actions) {
    snapshot = await runtime.runDemoAction(action);
  }
  return snapshot;
}

function expectNoSensitiveValues(candidate: unknown) {
  const encoded = JSON.stringify(candidate);
  expect(encoded).not.toContain("18 Sensitive Street");
  expect(encoded).not.toContain("Private diagnosis");
  expect(encoded).not.toContain("PRIVATE-API-KEY");
  expect(encoded).not.toContain("PRIVATE-ID");
  expect(encoded).not.toContain("PRIVATE-BANK");
  expect(encoded).not.toContain('"privateKey"');
  expect(encoded).not.toContain('"d":');
}

describe("RelayPass demo reliability", () => {
  it("completes twenty consecutive reset-to-revoked runs without replay or grant contamination", async () => {
    const runtime = await DemoRuntime.create();

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const reset = await runtime.runDemoAction("reset");
      expect(reset).toMatchObject({
        stage: "passport",
        outcomes: {},
        receipts: [],
        revocation: { rootRevoked: false },
      });

      const snapshot = await run(runtime, COMPLETE_FLOW);
      const state = await runtime.getTestState();

      expect(snapshot.stage).toBe("retry_refused");
      expect(snapshot.lastError).toBeUndefined();
      expect(snapshot.outcomes.flight?.decision.code).toBe("allowed");
      expect(snapshot.outcomes.homeAddress?.decision).toMatchObject({
        code: "unauthorized_context",
        disclosedContext: [],
      });
      expect(snapshot.outcomes.hotel?.decision.code).toBe("constraint_violation");
      expect(snapshot.outcomes.dinner?.decision.code).toBe("allowed");
      expect(snapshot.outcomes.dinner?.diagnosisDisclosed).toBe(false);
      expect(snapshot.outcomes.revokedRetry?.decision).toMatchObject({
        code: "relay_pass_revoked",
        semanticStatus: 401,
        disclosedContext: [],
      });
      expect(snapshot.receipts.map(({ event }) => event)).toEqual(EXPECTED_RECEIPT_EVENTS);
      expect(state.sideEffects).toEqual({ flightBookings: 1, hotelBookings: 0 });
      expect(state.passportReleaseCount).toBe(1);
      expect(state.revocationStatuses).toEqual({
        root: true,
        flight: true,
        stay: true,
        dinner: true,
      });
      expectNoSensitiveValues(snapshot);
      expectNoSensitiveValues(state.receipts);
    }
  });

  it("serializes rapid duplicate presentation actions into one logical outcome", async () => {
    const runtime = await DemoRuntime.create();
    const duplicate = (action: DemoAction) =>
      Promise.all(Array.from({ length: 8 }, () => runtime.runDemoAction(action)));

    await duplicate("request_consent");
    await duplicate("approve");
    await duplicate("derive");
    await duplicate("verify_flight");
    await duplicate("forbidden_context");
    await duplicate("over_budget_hotel");
    await duplicate("dinner_disclosure");
    await duplicate("revoke");
    const retries = await duplicate("retry_revoked_flight");

    const snapshot = retries.at(-1)!;
    const state = await runtime.getTestState();
    expect(snapshot.stage).toBe("retry_refused");
    expect(snapshot.receipts.map(({ event }) => event)).toEqual(EXPECTED_RECEIPT_EVENTS);
    expect(state.sideEffects).toEqual({ flightBookings: 1, hotelBookings: 0 });
    expect(state.passportReleaseCount).toBe(1);
    expect(
      state.receipts.filter(
        ({ requestId }) => requestId === "demo_flight_booking_authorized",
      ),
    ).toHaveLength(1);
    expect(
      state.receipts.filter(({ requestId }) => requestId === "demo_revoke_nova_root"),
    ).toHaveLength(1);
  });

  it("keeps two independently constructed runtimes isolated", async () => {
    const [first, second] = await Promise.all([DemoRuntime.create(), DemoRuntime.create()]);

    await run(first, [
      "request_consent",
      "approve",
      "derive",
      "verify_flight",
      "revoke",
      "retry_revoked_flight",
    ]);

    const firstState = await first.getTestState();
    const secondSnapshot = await second.getSnapshot();
    const secondState = await second.getTestState();

    expect(firstState.revocationStatuses.root).toBe(true);
    expect(firstState.sideEffects.flightBookings).toBe(1);
    expect(secondSnapshot).toMatchObject({
      stage: "passport",
      outcomes: {},
      receipts: [],
      revocation: { rootRevoked: false },
    });
    expect(secondState.passes).toEqual({});
    expect(secondState.sideEffects).toEqual({ flightBookings: 0, hotelBookings: 0 });
    expect(secondState.passportReleaseCount).toBe(0);
  });

  it("keeps every hero invariant fail-closed across a full run", async () => {
    const runtime = await DemoRuntime.create();
    const snapshot = await run(runtime, COMPLETE_FLOW);
    const state = await runtime.getTestState();

    expect(snapshot.outcomes.homeAddress).toMatchObject({
      sharedFields: 0,
      passportValueFetchCalled: false,
      decision: { allowed: false, disclosedContext: [] },
    });
    expect(snapshot.outcomes.hotel).toMatchObject({
      requestedAmount: 260,
      authorizedMaximum: 220,
      purchaseMade: false,
      decision: { allowed: false, code: "constraint_violation" },
    });
    expect(snapshot.outcomes.dinner).toMatchObject({
      requiredConstraint: true,
      diagnosisInPass: false,
      diagnosisDisclosed: false,
      disclosedContext: {
        "dietary.nut_free_required": true,
      },
    });
    expect(snapshot.outcomes.revokedRetry).toMatchObject({
      samePassId: true,
      sideEffectPerformed: false,
      decision: { allowed: false, code: "relay_pass_revoked" },
    });
    expect(state.passportReleaseCount).toBe(1);
    expect(state.sideEffects).toEqual({ flightBookings: 1, hotelBookings: 0 });
  });

  it("rejects unperformed hero actions after revocation without caching misleading outcomes", async () => {
    const runtime = await DemoRuntime.create();
    await run(runtime, ["request_consent", "approve", "derive", "revoke"]);
    const receiptsBefore = await runtime.getReceipts();

    for (const action of [
      "verify_flight",
      "forbidden_context",
      "over_budget_hotel",
      "dinner_disclosure",
    ] as const) {
      const snapshot = await runtime.runDemoAction(action);
      expect(snapshot.stage).toBe("root_revoked");
      expect(snapshot.lastError).toMatchObject({ code: "relay_pass_revoked" });
      expect(snapshot.outcomes).toEqual({});
      expect(snapshot.receipts).toEqual(
        expect.arrayContaining(
          receiptsBefore.map(({ receiptId }) => expect.objectContaining({ receiptId })),
        ),
      );
      expect(snapshot.receipts).toHaveLength(receiptsBefore.length);
    }

    const beforeRetry = await runtime.getTestState();
    expect(beforeRetry.passportReleaseCount).toBe(0);
    expect(beforeRetry.sideEffects).toEqual({ flightBookings: 0, hotelBookings: 0 });

    const retry = await runtime.runDemoAction("retry_revoked_flight");
    const afterRetry = await runtime.getTestState();
    expect(retry).toMatchObject({
      stage: "retry_refused",
      outcomes: {
        revokedRetry: {
          sideEffectPerformed: false,
          decision: { code: "relay_pass_revoked", semanticStatus: 401 },
        },
      },
    });
    expect(afterRetry.passportReleaseCount).toBe(0);
    expect(afterRetry.sideEffects).toEqual({ flightBookings: 0, hotelBookings: 0 });
  });
});
