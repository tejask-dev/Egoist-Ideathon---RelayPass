import { describe, expect, it } from "vitest";

import { sha256Base64Url } from "../../relaypass/canonical";
import type { RelayPass } from "../../relaypass/schemas";
import { DemoActionBodySchema } from "../demo-action-schema";
import {
  DEMO_IDS,
  DEMO_NEVER_DISCLOSE,
  DEMO_ROOT_CONTEXT,
  DEMO_VALID_UNTIL,
} from "../demo-fixtures";
import { DemoRuntime } from "../demo-runtime";

async function withRoot() {
  const runtime = await DemoRuntime.create();
  await runtime.requestRootConsent();
  await runtime.approveRootPass();
  return runtime;
}

async function withChildren() {
  const runtime = await withRoot();
  await runtime.deriveChildren();
  return runtime;
}

function expectAllowedSubset(child: readonly string[], parent: readonly string[]) {
  expect(child.every((item) => parent.includes(item))).toBe(true);
}

function expectRestrictionsPreserved(child: RelayPass, parent: RelayPass) {
  expectAllowedSubset(parent.context.neverDisclose, child.context.neverDisclose);
  expectAllowedSubset(parent.context.stepUpRequired, child.context.stepUpRequired);
  expectAllowedSubset(
    parent.authority.prohibitedActions,
    child.authority.prohibitedActions,
  );
}

describe("RelayPass seeded vertical demo", () => {
  it("rejects unsupported UI action names at the server request boundary", () => {
    const result = DemoActionBodySchema.safeParse({
      action: "derive_unrestricted_child",
    });

    expect(result.success).toBe(false);
  });

  it("rejects extra client-controlled paths, policy, limits, and action arguments", () => {
    const result = DemoActionBodySchema.safeParse({
      action: "derive",
      requestedContext: ["profile.home_address"],
      policy: { neverDisclose: [] },
      amount: 9_999,
      actionArguments: { amount: 9_999, currency: "USD" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            keys: expect.arrayContaining([
              "requestedContext",
              "policy",
              "amount",
              "actionArguments",
            ]),
          }),
        ]),
      );
    }
  });

  it("initializes Maya's deterministic 42-memory Passport with no authority issued", async () => {
    const runtime = await DemoRuntime.create();

    const snapshot = await runtime.initializeDemo();
    const state = await runtime.getTestState();

    expect(snapshot).toMatchObject({
      version: "relaypass-demo/1",
      stage: "passport",
      passport: {
        holder: "Maya",
        memoryCount: 42,
        sourceLabel: "Prototype PassportAdapter",
      },
      consent: { requested: false, approved: false, who: "Nova" },
      revocation: { rootRevoked: false },
    });
    expect(snapshot.passport.memories).toHaveLength(42);
    expect(snapshot.passport.memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "travel.origin_city" }),
        expect.objectContaining({ path: "profile.home_address", sensitivity: "restricted" }),
        expect.objectContaining({ path: "health.diagnosis", sensitivity: "restricted" }),
      ]),
    );
    expect(state.passes).toEqual({});
    expect(state.receipts).toEqual([]);
    expect(state.passportReleaseCount).toBe(0);
    expect(state.revocationStatuses).toEqual({
      root: false,
      flight: false,
      stay: false,
      dinner: false,
    });
  });

  it("presents Nova's exact human-readable consent ceiling before approval", async () => {
    const runtime = await DemoRuntime.create();

    const snapshot = await runtime.requestRootConsent();

    expect(snapshot.stage).toBe("consent");
    expect(snapshot.consent).toMatchObject({
      requested: true,
      approved: false,
      who: "Nova",
      expires: "2 hours",
    });
    expect(snapshot.consent.canSee).toHaveLength(7);
    expect(snapshot.consent.canDo).toEqual(
      expect.arrayContaining([
        "Book a flight up to $650",
        "Book a hotel up to $220",
        "Delegate only narrower trip subtasks",
      ]),
    );
    expect(snapshot.consent.cannot.join(" ")).toContain("home address");
    expect((await runtime.getTestState()).passes.root).toBeUndefined();
  });

  it("issues a real EdDSA-signed Nova root pass for exactly seven context paths and two hours", async () => {
    const runtime = await withRoot();

    const snapshot = await runtime.getSnapshot();
    const { root } = (await runtime.getTestState()).passes;

    expect(snapshot.stage).toBe("root_active");
    expect(snapshot.consent.approved).toBe(true);
    expect(root).toBeDefined();
    expect(root).toMatchObject({
      version: "relaypass/0.1",
      passId: DEMO_IDS.rootPass,
      rootConsentId: DEMO_IDS.consent,
      parentPassId: null,
      delegate: { agentId: DEMO_IDS.nova, displayName: "Nova" },
      proof: { type: "compact-jws", alg: "EdDSA" },
      lifecycle: { validUntil: DEMO_VALID_UNTIL },
    });
    expect(root?.proof.jws.split(".")).toHaveLength(3);
    expect(root?.context.read).toEqual(DEMO_ROOT_CONTEXT);
    expect(root?.context.read).not.toContain("profile.home_address");
    expect(root?.context.read).not.toContain("health.diagnosis");
    expect(Date.parse(root!.lifecycle.validUntil) - Date.parse(root!.lifecycle.validFrom)).toBe(
      2 * 60 * 60 * 1_000,
    );
  });

  it("records root issuance through ReceiptService without disclosing Passport values", async () => {
    const runtime = await withRoot();

    const receipts = await runtime.getReceipts();

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      rootConsentId: DEMO_IDS.consent,
      passId: DEMO_IDS.rootPass,
      parentPassId: null,
      agentId: DEMO_IDS.nova,
      event: "pass_issued",
      decision: "allowed",
      requestedContext: [...DEMO_ROOT_CONTEXT],
      disclosedContext: [],
    });
    expect(JSON.stringify(receipts)).not.toContain("18 Sensitive Street");
  });

  it("derives three real parent-linked and chain-verified child passes", async () => {
    const runtime = await withChildren();

    const snapshot = await runtime.getSnapshot();
    const state = await runtime.getTestState();
    const root = state.passes.root!;

    expect(Object.keys(state.passes).sort()).toEqual(["dinner", "flight", "root", "stay"]);
    for (const kind of ["flight", "stay", "dinner"] as const) {
      const child = state.passes[kind]!;
      const node = snapshot.relayTree.nodes.find((candidate) => candidate.id === kind);
      expect(child.parentPassId).toBe(root.passId);
      expect(child.parentPassHash).toBe(sha256Base64Url(root.proof.jws));
      expect(child.rootConsentId).toBe(root.rootConsentId);
      expect(child.issuer.id).toBe(root.delegate.agentId);
      expect(child.proof.kid).toBe(root.delegate.keyId);
      expect(child.proof.jws.split(".")).toHaveLength(3);
      expect(state.chains[kind]).toEqual([root, child]);
      expect(node?.technicalProof).toMatchObject({
        signatureVerified: true,
        chainVerified: true,
        parentPassId: root.passId,
      });
    }
    expect(state.receipts.filter(({ event }) => event === "pass_derived")).toHaveLength(3);
  });

  it("attenuates FlightAgent to four context paths plus a $650 flight capability", async () => {
    const { passes } = await (await withChildren()).getTestState();
    const root = passes.root!;
    const flight = passes.flight!;

    expect(flight.context.read).toEqual([
      "travel.origin_city",
      "travel.destination",
      "calendar.required_arrival_time",
      "travel.seat_preference",
    ]);
    expect(flight.authority.allowedActions).toEqual([
      expect.objectContaining({
        action: "flight.book",
        targets: ["airline.simulated"],
        constraints: {
          amount: { kind: "max", value: 650 },
          currency: { kind: "exact", value: "USD" },
        },
      }),
    ]);
    expectAllowedSubset(flight.context.read, root.context.read);
    expect(flight.context.read.length).toBeLessThan(root.context.read.length);
    expectRestrictionsPreserved(flight, root);
  });

  it("attenuates StayAgent to two context paths plus a $220 hotel capability", async () => {
    const { passes } = await (await withChildren()).getTestState();
    const root = passes.root!;
    const stay = passes.stay!;

    expect(stay.context.read).toEqual(["travel.destination", "trip.event_area"]);
    expect(stay.authority.allowedActions).toEqual([
      expect.objectContaining({
        action: "hotel.book",
        targets: ["hotel.simulated"],
        constraints: {
          amount: { kind: "max", value: 220 },
          currency: { kind: "exact", value: "USD" },
        },
      }),
    ]);
    expectAllowedSubset(stay.context.read, root.context.read);
    expect(stay.context.read.length).toBeLessThan(root.context.read.length);
    expectRestrictionsPreserved(stay, root);
  });

  it("attenuates DinnerAgent to timing and the functional nut-free requirement with no spend", async () => {
    const { passes } = await (await withChildren()).getTestState();
    const root = passes.root!;
    const dinner = passes.dinner!;

    expect(dinner.context.read).toEqual([
      "calendar.required_arrival_time",
      "dietary.nut_free_required",
    ]);
    expect(dinner.authority.allowedActions).toEqual([]);
    expect(dinner.context.read).not.toContain("health.diagnosis");
    expect(dinner.context.neverDisclose).toContain("health.diagnosis");
    expectAllowedSubset(dinner.context.read, root.context.read);
    expectRestrictionsPreserved(dinner, root);
  });

  it("renders the required 42 -> 7 -> 5 / 3 / 2 Relay Tree contract from domain state", async () => {
    const snapshot = await (await withChildren()).getSnapshot();

    expect(snapshot.relayTree.visibleEquation).toBe("42 \u2192 7 \u2192 5 / 3 / 2");
    expect(
      snapshot.relayTree.nodes.map(({ id, visibleCount, status }) => ({
        id,
        visibleCount,
        status,
      })),
    ).toEqual([
      { id: "maya", visibleCount: 42, status: "active" },
      { id: "nova", visibleCount: 7, status: "active" },
      { id: "flight", visibleCount: 5, status: "active" },
      { id: "stay", visibleCount: 3, status: "active" },
      { id: "dinner", visibleCount: 2, status: "active" },
    ]);
  });

  it("authorizes the $612 flight through the real verifier and performs one booking side effect", async () => {
    const runtime = await withChildren();

    const snapshot = await runtime.verifyAndBookFlight();
    const state = await runtime.getTestState();
    const result = snapshot.outcomes.flight!;

    expect(result.decision).toMatchObject({
      allowed: true,
      code: "allowed",
      semanticStatus: 200,
    });
    expect(result.sideEffectPerformed).toBe(true);
    expect(result.booking).toEqual({
      bookingId: "FL-4821",
      route: "YYZ to SFO",
      amount: 612,
      currency: "USD",
    });
    expect(result.checks).toHaveLength(9);
    expect(result.checks.every(({ status }) => status === "passed")).toBe(true);
    expect(result.technicalProof).toMatchObject({
      passId: DEMO_IDS.flightPass,
      signatureVerified: true,
      chainVerified: true,
      revocationStatus: "active",
    });
    expect(state.sideEffects.flightBookings).toBe(1);
    expect(state.receipts.at(-1)).toMatchObject({
      passId: DEMO_IDS.flightPass,
      event: "action_allowed",
      decision: "allowed",
    });
  });

  it("keeps the seeded successful flight operation idempotent for rehearsal", async () => {
    const runtime = await withChildren();

    await runtime.verifyAndBookFlight();
    await runtime.verifyAndBookFlight();
    const state = await runtime.getTestState();

    expect(state.sideEffects.flightBookings).toBe(1);
    expect(
      state.receipts.filter(({ requestId }) => requestId === "demo_flight_booking_authorized"),
    ).toHaveLength(1);
  });

  it("blocks FlightAgent's home-address request before disclosure with zero adapter reads", async () => {
    const runtime = await withChildren();
    const releaseCountBefore = (await runtime.getTestState()).passportReleaseCount;

    const snapshot = await runtime.runHomeAddressAttack();
    const state = await runtime.getTestState();
    const result = snapshot.outcomes.homeAddress!;

    expect(result).toMatchObject({
      requestedPath: "profile.home_address",
      sharedFields: 0,
      passportValueFetchCalled: false,
      decision: {
        allowed: false,
        code: "unauthorized_context",
        semanticStatus: 403,
        disclosedContext: [],
      },
    });
    expect(state.passportReleaseCount).toBe(releaseCountBefore);
    expect(state.outcomes.homeAddress).toEqual(result);
  });

  it("links the home-address refusal receipt to the FlightAgent child and root", async () => {
    const runtime = await withChildren();

    const snapshot = await runtime.runHomeAddressAttack();
    const receipt = (await runtime.getReceipts()).find(
      ({ receiptId }) => receiptId === snapshot.outcomes.homeAddress?.receiptId,
    );

    expect(receipt).toMatchObject({
      rootConsentId: DEMO_IDS.consent,
      passId: DEMO_IDS.flightPass,
      parentPassId: DEMO_IDS.rootPass,
      agentId: DEMO_IDS.flight,
      verifierId: DEMO_IDS.airline,
      event: "context_refused",
      decision: "refused",
      reason: "unauthorized_context",
      requestedContext: ["profile.home_address"],
      disclosedContext: [],
    });
  });

  it("refuses StayAgent's $260 hotel action under its signed $220 ceiling with no purchase", async () => {
    const runtime = await withChildren();

    const snapshot = await runtime.runOverBudgetHotelAttack();
    const state = await runtime.getTestState();
    const result = snapshot.outcomes.hotel!;

    expect(result).toMatchObject({
      requestedAmount: 260,
      authorizedMaximum: 220,
      purchaseMade: false,
      decision: {
        allowed: false,
        code: "constraint_violation",
        semanticStatus: 403,
        disclosedContext: [],
      },
    });
    expect(state.sideEffects.hotelBookings).toBe(0);
    expect(state.receipts.at(-1)).toMatchObject({
      rootConsentId: DEMO_IDS.consent,
      passId: DEMO_IDS.stayPass,
      parentPassId: DEMO_IDS.rootPass,
      event: "action_refused",
      reason: "constraint_violation",
    });
  });

  it("discloses only dinner timing and nut_free_required=true, never the diagnosis", async () => {
    const runtime = await withChildren();

    const snapshot = await runtime.runDinnerMinimumDisclosure();
    const state = await runtime.getTestState();
    const result = snapshot.outcomes.dinner!;

    expect(result.decision).toMatchObject({
      allowed: true,
      code: "allowed",
      disclosedContext: [
        "calendar.required_arrival_time",
        "dietary.nut_free_required",
      ],
    });
    expect(result.disclosedContext).toEqual({
      "calendar.required_arrival_time": "Tomorrow, 6:00 PM",
      "dietary.nut_free_required": true,
    });
    expect(result).toMatchObject({
      requiredConstraint: true,
      diagnosisInPass: false,
      diagnosisDisclosed: false,
    });
    expect(result.disclosedContext).not.toHaveProperty("health.diagnosis");
    expect(state.passportReleaseCount).toBe(1);
    expect(state.receipts.at(-1)).toMatchObject({
      passId: DEMO_IDS.dinnerPass,
      event: "context_read",
      disclosedContext: [
        "calendar.required_arrival_time",
        "dietary.nut_free_required",
      ],
    });
  });

  it("denies DinnerAgent's signed diagnosis request before any Passport value fetch", async () => {
    const runtime = await withChildren();

    const result = await runtime.attemptDinnerDiagnosisForTest();

    expect(result).toMatchObject({
      decision: {
        allowed: false,
        code: "unauthorized_context",
        semanticStatus: 403,
        disclosedContext: [],
      },
      disclosedContext: undefined,
      passportValueFetchCalled: false,
      receipt: {
        rootConsentId: DEMO_IDS.consent,
        passId: DEMO_IDS.dinnerPass,
        parentPassId: DEMO_IDS.rootPass,
        event: "context_refused",
        requestedContext: ["health.diagnosis"],
        disclosedContext: [],
      },
    });
    expect((await runtime.getTestState()).passportReleaseCount).toBe(0);
  });

  it("builds a causal receipt set with the correct root, child, and verifier linkage", async () => {
    const runtime = await withChildren();
    await runtime.verifyAndBookFlight();
    await runtime.runHomeAddressAttack();
    await runtime.runOverBudgetHotelAttack();
    await runtime.runDinnerMinimumDisclosure();

    const receipts = await runtime.getReceipts();
    const eventsFor = (passId: string) =>
      receipts.filter((receipt) => receipt.passId === passId).map(({ event }) => event);

    expect(receipts).toHaveLength(8);
    expect(receipts.every(({ rootConsentId }) => rootConsentId === DEMO_IDS.consent)).toBe(true);
    expect(eventsFor(DEMO_IDS.rootPass)).toEqual(["pass_issued"]);
    expect(eventsFor(DEMO_IDS.flightPass)).toEqual([
      "pass_derived",
      "action_allowed",
      "context_refused",
    ]);
    expect(eventsFor(DEMO_IDS.stayPass)).toEqual([
      "pass_derived",
      "action_refused",
    ]);
    expect(eventsFor(DEMO_IDS.dinnerPass)).toEqual([
      "pass_derived",
      "context_read",
    ]);
    expect(
      receipts
        .filter(({ parentPassId }) => parentPassId !== null)
        .every(({ parentPassId }) => parentPassId === DEMO_IDS.rootPass),
    ).toBe(true);
  });

  it("keeps sensitive values and raw action arguments out of receipts", async () => {
    const runtime = await withChildren();
    await runtime.verifyAndBookFlight();
    await runtime.runHomeAddressAttack();
    await runtime.runOverBudgetHotelAttack();
    await runtime.runDinnerMinimumDisclosure();

    const receipts = await runtime.getReceipts();
    const encoded = JSON.stringify(receipts);
    const actionReceipts = receipts.filter(({ action }) => action);

    expect(encoded).not.toContain("18 Sensitive Street");
    expect(encoded).not.toContain("Private diagnosis");
    expect(encoded).not.toContain('"amount":260');
    expect(encoded).not.toContain('"amount":612');
    expect(actionReceipts).toHaveLength(2);
    expect(
      actionReceipts.every(({ action }) =>
        /^[A-Za-z0-9_-]{43}$/.test(action?.argumentsHash ?? ""),
      ),
    ).toBe(true);
  });

  it("rejects a client-style child widening probe and persists no malicious pass", async () => {
    const runtime = await withRoot();

    const result = await runtime.attemptWideningProbeForTest();

    expect(result).toMatchObject({
      rejected: true,
      code: "invalid_derivation",
      passCountBefore: 1,
      passCountAfter: 1,
    });
    expect(result.message).toContain("context read set expanded");
    expect(Object.values((await runtime.getTestState()).passes).filter(Boolean)).toHaveLength(1);
  });

  it("fails safely when a UI-facing action is invoked out of order", async () => {
    const runtime = await DemoRuntime.create();

    const snapshot = await runtime.runDemoAction("derive");

    expect(snapshot.stage).toBe("passport");
    expect(snapshot.lastError).toEqual({
      code: "demo_error",
      message: "Approve Nova's root permission first",
    });
    expect((await runtime.getTestState()).passes).toEqual({});
  });

  it("marks Nova revoked and every child invalid from live root status", async () => {
    const runtime = await withChildren();

    const receiptsBefore = await runtime.getReceipts();
    const snapshot = await runtime.revokeRoot();
    const state = await runtime.getTestState();

    expect(snapshot.stage).toBe("root_revoked");
    expect(snapshot.revocation.rootRevoked).toBe(true);
    expect(snapshot.relayTree.nodes.find(({ id }) => id === "nova")?.status).toBe("revoked");
    for (const id of ["flight", "stay", "dinner"] as const) {
      expect(snapshot.relayTree.nodes.find((node) => node.id === id)?.status).toBe("invalid");
    }
    expect(state.revocationStatuses).toEqual({
      root: true,
      flight: true,
      stay: true,
      dinner: true,
    });
    expect(state.receipts.slice(0, -1)).toEqual(receiptsBefore);
    expect(state.receipts.at(-1)).toMatchObject({
      passId: DEMO_IDS.rootPass,
      event: "pass_revoked",
      agentId: "maya",
    });
  });

  it("fails a formerly valid FlightAgent pass on a fresh post-revocation live check", async () => {
    const runtime = await withChildren();
    await runtime.verifyAndBookFlight();
    const sideEffectsBefore = (await runtime.getTestState()).sideEffects.flightBookings;
    await runtime.revokeRoot();

    const snapshot = await runtime.retryRevokedFlight();
    const state = await runtime.getTestState();
    const result = snapshot.outcomes.revokedRetry!;

    expect(snapshot.stage).toBe("retry_refused");
    expect(result).toMatchObject({
      samePassId: true,
      sideEffectPerformed: false,
      decision: {
        allowed: false,
        code: "relay_pass_revoked",
        semanticStatus: 401,
        disclosedContext: [],
      },
      technicalProof: {
        passId: DEMO_IDS.flightPass,
        revocationStatus: "invalid",
      },
    });
    expect(result.checks.find(({ id }) => id === "revocation")?.status).toBe("failed");
    expect(state.sideEffects.flightBookings).toBe(sideEffectsBefore);
    expect(state.receipts.at(-1)).toMatchObject({
      passId: DEMO_IDS.flightPass,
      event: "action_refused",
      reason: "relay_pass_revoked",
    });
  });

  it("resets passes, receipts, revocation, grants, replay state, and side-effect counters", async () => {
    const runtime = await withChildren();
    await runtime.verifyAndBookFlight();
    await runtime.runDinnerMinimumDisclosure();
    await runtime.revokeRoot();

    const snapshot = await runtime.resetDemo();
    const state = await runtime.getTestState();

    expect(snapshot).toMatchObject({
      stage: "passport",
      consent: { requested: false, approved: false },
      revocation: { rootRevoked: false },
      outcomes: {},
      receipts: [],
    });
    expect(snapshot.passport.memoryCount).toBe(42);
    expect(state.passes).toEqual({});
    expect(state.receipts).toEqual([]);
    expect(state.passportReleaseCount).toBe(0);
    expect(state.sideEffects).toEqual({ flightBookings: 0, hotelBookings: 0 });
    expect(state.revocationStatuses).toEqual({
      root: false,
      flight: false,
      stay: false,
      dinner: false,
    });
  });

  it("runs the same deterministic flight flow again after reset with cleared replay state", async () => {
    const runtime = await withChildren();
    await runtime.verifyAndBookFlight();
    const firstPass = (await runtime.getTestState()).passes.root!;

    await runtime.resetDemo();
    await runtime.requestRootConsent();
    await runtime.approveRootPass();
    await runtime.deriveChildren();
    const secondSnapshot = await runtime.verifyAndBookFlight();
    const secondState = await runtime.getTestState();

    expect(secondSnapshot.outcomes.flight?.decision).toMatchObject({
      allowed: true,
      code: "allowed",
    });
    expect(secondState.sideEffects.flightBookings).toBe(1);
    expect(secondState.receipts).toHaveLength(5);
    expect(secondState.passes.root?.passId).toBe(firstPass.passId);
    expect(secondState.passes.root?.delegate.publicKey).toEqual(firstPass.delegate.publicKey);
  });

  it("returns only client-safe snapshots with no private keys or seeded sensitive values", async () => {
    const runtime = await withChildren();
    await runtime.verifyAndBookFlight();
    await runtime.runDinnerMinimumDisclosure();

    const encoded = JSON.stringify(await runtime.getSnapshot());

    expect(encoded).not.toContain('"privateKey"');
    expect(encoded).not.toContain('"d":');
    expect(encoded).not.toContain("PRIVATE-");
    expect(encoded).not.toContain("18 Sensitive Street");
    expect(encoded).not.toContain("Private diagnosis");
    for (const path of DEMO_NEVER_DISCLOSE) {
      expect(encoded).not.toContain(path + "=");
    }
  });
});
