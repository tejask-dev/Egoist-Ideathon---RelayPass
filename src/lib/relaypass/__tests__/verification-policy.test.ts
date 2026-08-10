import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActionExecutionService,
  ChainVerifier,
  ContextDisclosureService,
  InMemoryPassportAdapter,
  InMemoryTrustedRootKeyStore,
  UnsignedRelayPassSchema,
  type PassportAdapter,
  type RelayPass,
  type RevocationRepository,
} from "../index";
import {
  CHILD_VALID_UNTIL,
  FLIGHT_PASS_ID,
  NOW,
  ROOT_CONSENT_ID,
  SCOUT_PASS_ID,
  STAY_PASS_ID,
  clone,
  createPolicyHarness,
  generateTestSigners,
  issueFlightChain,
  issueHotelScoutChain,
  issueRoot,
  issueStayChain,
  signRequest,
  type TestSigners,
} from "./fixtures";

function corruptSignature<T extends { proof: { jws: string } }>(value: T): T {
  const corrupted = clone(value);
  const segments = corrupted.proof.jws.split(".");
  if (segments.length !== 3 || !segments[2]) {
    throw new Error("Fixture did not produce a compact JWS");
  }
  const first = segments[2][0];
  segments[2] = `${first === "A" ? "B" : "A"}${segments[2].slice(1)}`;
  corrupted.proof.jws = segments.join(".");
  return corrupted;
}

describe("chain verification and fail-closed policy evaluation", () => {
  let signers: TestSigners;

  beforeAll(async () => {
    signers = await generateTestSigners();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("verifies a valid parent-linked chain with real Ed25519 signatures", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify(chain, {
      expectedAgentId: "agent-flight",
      expectedServiceId: "service-airline",
      now: new Date(NOW),
    });

    expect(result).toMatchObject({ valid: true, leaf: { passId: flight.passId } });
    expect(flight.proof).toMatchObject({
      type: "compact-jws",
      alg: "EdDSA",
      kid: signers.nova.keyId,
    });
    expect(flight.proof.jws.split(".")).toHaveLength(3);
  });

  it("fails an invalid parent chain", async () => {
    const { flight } = await issueFlightChain(signers);
    const unrelatedRoot = await issueRoot(signers, "rp_unrelated_root");
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([unrelatedRoot, flight], {
      now: new Date(NOW),
    });

    expect(result).toEqual({
      valid: false,
      code: "invalid_chain",
      message: "Parent-child linkage is invalid",
    });
  });

  it("fails a child carrying an invalid parent hash even when that child is validly signed", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const presented: Partial<RelayPass> = clone(flight);
    delete presented.proof;
    const unsigned = UnsignedRelayPassSchema.parse(presented);
    unsigned.parentPassHash = "A".repeat(43);
    const childWithBadHash = await signers.nova.sign(unsigned);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, childWithBadHash], {
      now: new Date(NOW),
    });

    expect(result).toEqual({
      valid: false,
      code: "invalid_chain",
      message: "Parent-child linkage is invalid",
    });
  });

  it("fails an invalid signature", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, corruptSignature<RelayPass>(flight)], {
      now: new Date(NOW),
    });

    expect(result).toMatchObject({ valid: false, code: "invalid_signature" });
  });

  it("fails a cryptographically valid root whose key is not trusted", async () => {
    const { chain } = await issueFlightChain(signers);
    const chainVerifier = new ChainVerifier(new InMemoryTrustedRootKeyStore());

    const result = await chainVerifier.verify(chain, { now: new Date(NOW) });

    expect(result).toEqual({
      valid: false,
      code: "untrusted_root",
      message: "Root issuer key is not trusted",
    });
  });

  it("fails when the presenting agent is not the signed delegate", async () => {
    const { chain } = await issueFlightChain(signers);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify(chain, {
      expectedAgentId: "agent-stay",
      expectedServiceId: "service-airline",
      now: new Date(NOW),
    });

    expect(result).toEqual({
      valid: false,
      code: "wrong_delegate",
      message: "Requesting agent is not the pass delegate",
    });
  });

  it("fails when the verifier is outside the pass audience", async () => {
    const { chain } = await issueFlightChain(signers);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify(chain, {
      expectedAgentId: "agent-flight",
      expectedServiceId: "service-hotel",
      now: new Date(NOW),
    });

    expect(result).toEqual({
      valid: false,
      code: "wrong_audience",
      message: "Verifier is outside the pass audience",
    });
  });

  it("fails an expired pass at the exact valid-until boundary", async () => {
    const { chain } = await issueFlightChain(signers);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify(chain, {
      expectedAgentId: "agent-flight",
      expectedServiceId: "service-airline",
      now: new Date(CHILD_VALID_UNTIL),
    });

    expect(result).toMatchObject({
      valid: false,
      code: "relay_pass_expired",
    });
  });

  it("fails a pass before its valid-from boundary", async () => {
    const { chain } = await issueFlightChain(signers);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify(chain, {
      expectedAgentId: "agent-flight",
      expectedServiceId: "service-airline",
      now: new Date("2026-08-09T11:59:59.999Z"),
    });

    expect(result).toMatchObject({
      valid: false,
      code: "relay_pass_not_yet_valid",
    });
  });

  it("revokes a root live and invalidates a previously usable descendant", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, receipts, revocations, contextConsumer } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        {
          path: "travel.destination",
          value: "San Francisco",
          sensitivity: "standard",
        },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const beforeRequest = await signRequest(signers.flight, {
      requestId: "request_flight_before_root_revocation",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });
    const beforeRevocation = await disclosure.authorizeAndRelease(chain, beforeRequest);

    await revocations.revokeRoot(
      ROOT_CONSENT_ID,
      "Maya cancelled Nova's trip authority",
      "2026-08-09T17:59:30.000Z",
    );
    const afterRequest = await signRequest(signers.flight, {
      requestId: "request_flight_after_root_revocation",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });
    const afterRevocation = await evaluator.evaluate(chain, afterRequest);

    expect(beforeRevocation.decision).toMatchObject({
      allowed: true,
      code: "allowed",
      disclosedContext: ["travel.destination"],
    });
    expect(afterRevocation.decision).toMatchObject({
      allowed: false,
      code: "relay_pass_revoked",
      semanticStatus: 401,
      disclosedContext: [],
    });
    expect(afterRevocation.receipt).toMatchObject({
      event: "context_refused",
      decision: "refused",
      reason: "relay_pass_revoked",
      disclosedContext: [],
    });

    const durableReceipts = await receipts.listByRoot(ROOT_CONSENT_ID);
    expect(durableReceipts).toHaveLength(2);
    expect(durableReceipts[0]).toMatchObject({
      requestId: "request_flight_before_root_revocation",
      decision: "allowed",
    });
  });

  it("revokes an ancestor branch and invalidates its descendant chain", async () => {
    const { chain, hotelScout } = await issueHotelScoutChain(signers);
    const { evaluator, revocations } = createPolicyHarness(signers, "service-hotel");

    await revocations.revokeBranch(
      STAY_PASS_ID,
      ROOT_CONSENT_ID,
      "Maya cancelled the lodging branch",
      "2026-08-09T17:59:30.000Z",
    );
    const request = await signRequest(signers.hotelScout, {
      requestId: "request_hotel_scout_after_branch_revocation",
      passId: hotelScout.passId,
      serviceId: "service-hotel",
      requestedContext: ["travel.destination"],
    });
    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "relay_pass_revoked",
      semanticStatus: 401,
      disclosedContext: [],
    });
    expect(result.receipt).toMatchObject({
      passId: SCOUT_PASS_ID,
      event: "context_refused",
      reason: "relay_pass_revoked",
      disclosedContext: [],
    });
  });

  it("blocks unauthorized context before calling the value adapter and records zero disclosure", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, receipts, contextConsumer } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        {
          path: "profile.home_address",
          value: "18 Sensitive Street",
          sensitivity: "restricted",
        },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const releaseSpy = vi.spyOn(passport, "releaseAuthorizedContext");
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "attack_a_home_address",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["profile.home_address"],
    });

    const result = await disclosure.authorizeAndRelease(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "unauthorized_context",
      semanticStatus: 403,
      disclosedContext: [],
    });
    expect(result).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("contextGrant");
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(result.receipt).toMatchObject({
      event: "context_refused",
      decision: "refused",
      reason: "unauthorized_context",
      requestedContext: ["profile.home_address"],
      disclosedContext: [],
      timestamp: NOW,
    });
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([result.receipt]);
  });

  it("returns step-up with no data or adapter call", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, receipts, contextConsumer } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        {
          path: "commerce.payment_method",
          value: "card_on_file",
          sensitivity: "sensitive",
        },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const releaseSpy = vi.spyOn(passport, "releaseAuthorizedContext");
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "request_step_up_payment_method",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["commerce.payment_method"],
    });

    const result = await disclosure.authorizeAndRelease(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "step_up_required",
      semanticStatus: 403,
      disclosedContext: [],
    });
    expect(result.receipt).toMatchObject({
      event: "step_up_required",
      decision: "pending_user",
      disclosedContext: [],
    });
    expect(result).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("contextGrant");
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("refuses an unauthorized action and produces an action refusal receipt", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, actionConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const service = new ActionExecutionService(evaluator, actionConsumer, receipts);
    const simulatedAirlineAction = vi.fn(async () => ({ ok: true }));
    const request = await signRequest(signers.flight, {
      requestId: "request_unauthorized_flight_cancel",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.cancel",
        target: "airline.simulated",
        arguments: { bookingId: "booking_123" },
      },
    });

    const result = await service.authorizeAndExecute(
      chain,
      request,
      simulatedAirlineAction,
    );

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "unauthorized_action",
      semanticStatus: 403,
      disclosedContext: [],
    });
    expect(simulatedAirlineAction).not.toHaveBeenCalled();
    expect(result.receipt).toMatchObject({
      event: "action_refused",
      decision: "refused",
      reason: "unauthorized_action",
      disclosedContext: [],
      action: {
        name: "flight.cancel",
        target: "airline.simulated",
        argumentsHash: expect.any(String),
      },
    });
  });

  it("refuses a $260 hotel request against the signed $220 maximum", async () => {
    const { chain, stay } = await issueStayChain(signers);
    const { evaluator, actionConsumer, receipts } = createPolicyHarness(
      signers,
      "service-hotel",
    );
    const service = new ActionExecutionService(evaluator, actionConsumer, receipts);
    const simulatedHotelPurchase = vi.fn(async () => ({ bookingId: "hotel_123" }));
    const request = await signRequest(signers.stay, {
      requestId: "attack_b_hotel_over_limit",
      passId: stay.passId,
      serviceId: "service-hotel",
      requestedContext: [],
      action: {
        name: "hotel.book",
        target: "hotel.simulated",
        arguments: { amount: 260, currency: "USD" },
      },
    });

    const result = await service.authorizeAndExecute(
      chain,
      request,
      simulatedHotelPurchase,
    );

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "constraint_violation",
      semanticStatus: 403,
      disclosedContext: [],
    });
    expect(simulatedHotelPurchase).not.toHaveBeenCalled();
    expect(result.receipt).toMatchObject({
      event: "action_refused",
      decision: "refused",
      reason: "constraint_violation",
      disclosedContext: [],
      action: {
        name: "hotel.book",
        target: "hotel.simulated",
        argumentsHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
    });
    expect(result.receipt?.action).not.toHaveProperty("arguments");
    expect(JSON.stringify(result.receipt)).not.toContain('"amount":260');
  });

  it("fails a forged delegate request proof", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator } = createPolicyHarness(signers, "service-airline");
    const signed = await signRequest(signers.flight, {
      requestId: "request_forged_proof",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });

    const result = await evaluator.evaluate(chain, corruptSignature(signed));

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "invalid_signature",
      semanticStatus: 401,
      disclosedContext: [],
    });
    expect(result).not.toHaveProperty("contextGrant");
  });

  it("binds policy evaluation to the configured verifier identity", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator } = createPolicyHarness(signers, "service-airline");
    const request = await signRequest(signers.flight, {
      requestId: "request_wrong_configured_verifier",
      passId: flight.passId,
      serviceId: "service-hotel",
      requestedContext: [],
    });

    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "wrong_audience",
      semanticStatus: 403,
      disclosedContext: [],
    });
  });

  it("rejects a request signed by another agent without attributing a receipt", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator } = createPolicyHarness(signers, "service-airline");
    const request = await signRequest(signers.stay, {
      requestId: "request_wrong_delegate",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
    });

    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "invalid_signature",
      semanticStatus: 401,
      disclosedContext: [],
    });
    expect(result.receipt).toBeUndefined();
  });

  it("rejects signed purpose scopes outside the pass", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator } = createPolicyHarness(signers, "service-airline");
    const request = await signRequest(signers.flight, {
      requestId: "request_wrong_purpose",
      passId: flight.passId,
      serviceId: "service-airline",
      purposeScopes: ["payments.transfer"],
      requestedContext: [],
    });

    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "wrong_purpose",
      semanticStatus: 403,
      disclosedContext: [],
    });
  });

  it("rejects replay of a previously consumed signed request ID", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator } = createPolicyHarness(signers, "service-airline");
    const request = await signRequest(signers.flight, {
      requestId: "request_replay_once",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
    });

    const first = await evaluator.evaluate(chain, request);
    const replay = await evaluator.evaluate(chain, request);

    expect(first.decision).toMatchObject({ allowed: true, code: "allowed" });
    expect(replay.decision).toMatchObject({
      allowed: false,
      code: "request_replayed",
      semanticStatus: 401,
      disclosedContext: [],
    });
  });

  it("fails closed when live revocation status is unavailable", async () => {
    const unavailableRepository: RevocationRepository = {
      async save() {},
      async findRoot() {
        throw new Error("status backend unavailable");
      },
      async findBranch() {
        throw new Error("status backend unavailable");
      },
    };
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator } = createPolicyHarness(
      signers,
      "service-airline",
      unavailableRepository,
    );
    const request = await signRequest(signers.flight, {
      requestId: "request_revocation_backend_down",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });

    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "revocation_status_unavailable",
      semanticStatus: 401,
      disclosedContext: [],
    });
    expect(result).not.toHaveProperty("contextGrant");
  });

  it("releases allowed context through a one-use disclosure grant", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        {
          path: "travel.destination",
          value: "San Francisco",
          sensitivity: "standard",
        },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "request_authorized_destination",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });

    const result = await disclosure.authorizeAndRelease(chain, request);

    expect(result.decision).toMatchObject({ allowed: true, code: "allowed" });
    expect(result.context).toEqual({ "travel.destination": "San Francisco" });
    if (!result.contextGrant) throw new Error("Allowed request did not return a grant");
    await expect(
      passport.releaseAuthorizedContext(result.contextGrant),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "Disclosure grant is invalid or already consumed",
    });
  });

  it("rechecks revocation between authorization and ContextDisclosureService release", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts, revocations } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        {
          path: "travel.destination",
          value: "San Francisco",
          sensitivity: "standard",
        },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const revokingPassport: PassportAdapter = {
      listMemoryMetadata: () => passport.listMemoryMetadata(),
      releaseAuthorizedContext: async (grant) => {
        await revocations.revokeRoot(
          ROOT_CONSENT_ID,
          "Revoked between verification and disclosure",
          "2026-08-09T18:00:00.000Z",
        );
        return passport.releaseAuthorizedContext(grant);
      },
    };
    const disclosure = new ContextDisclosureService(
      evaluator,
      revokingPassport,
      receipts,
    );
    const request = await signRequest(signers.flight, {
      requestId: "request_revoked_during_release",
      passId: FLIGHT_PASS_ID,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });

    await expect(disclosure.authorizeAndRelease(chain, request)).rejects.toMatchObject({
      code: "invalid_input",
      message: "Pass was revoked before context release",
    });
  });

  it("does not release context when the pass expires between authorization and consumption", async () => {
    const evaluationTime = new Date("2026-08-10T05:59:55.000Z");
    const releaseTime = new Date(CHILD_VALID_UNTIL);
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
      undefined,
      () => evaluationTime,
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        {
          path: "travel.destination",
          value: "San Francisco",
          sensitivity: "standard",
        },
      ],
      contextConsumer,
      () => releaseTime,
    );
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "request_context_expires_before_release",
      passId: flight.passId,
      serviceId: "service-airline",
      issuedAt: "2026-08-10T05:59:54.000Z",
      expiresAt: "2026-08-10T06:00:30.000Z",
      requestedContext: ["travel.destination"],
    });

    await expect(disclosure.authorizeAndRelease(chain, request)).rejects.toMatchObject({
      code: "invalid_input",
      message: "Disclosure grant has expired",
    });
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("binds a context grant to the verified holder's Passport store", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const request = await signRequest(signers.flight, {
      requestId: "request_wrong_holder_store",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });
    const evaluation = await evaluator.evaluate(chain, request);
    const otherHolderPassport = new InMemoryPassportAdapter(
      "another_holder_pairwise_id",
      [
        {
          path: "travel.destination",
          value: "Private destination for another holder",
          sensitivity: "standard",
        },
      ],
      contextConsumer,
      () => new Date(NOW),
    );

    expect(evaluation.decision).toMatchObject({ allowed: true, code: "allowed" });
    expect(evaluation.receipt).toBeUndefined();
    if (!evaluation.contextGrant) throw new Error("Allowed context request lacks a grant");
    await expect(
      otherHolderPassport.releaseAuthorizedContext(evaluation.contextGrant),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "Disclosure grant belongs to a different holder",
    });
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("executes an allowed action once and records success only after the callback", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, actionConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const service = new ActionExecutionService(evaluator, actionConsumer, receipts);
    const execute = vi.fn(async () => ({ bookingId: "flight_booking_123" }));
    const request = await signRequest(signers.flight, {
      requestId: "request_allowed_flight_booking",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: { amount: 600, currency: "USD" },
      },
    });

    const result = await service.authorizeAndExecute(chain, request, execute);

    expect(execute).toHaveBeenCalledOnce();
    expect(result.execution).toEqual({ bookingId: "flight_booking_123" });
    expect(result.receipt).toMatchObject({
      event: "action_allowed",
      decision: "allowed",
      requestId: "request_allowed_flight_booking",
    });
    expect(result.decision.receiptId).toBe(result.receipt?.receiptId);
    if (!result.actionGrant) throw new Error("Allowed action request lacks a grant");
    await expect(actionConsumer.consume(result.actionGrant)).rejects.toMatchObject({
      code: "invalid_input",
      message: "Action grant is invalid or already consumed",
    });
  });

  it("rechecks revocation after policy allow and before action execution", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, actionConsumer, receipts, revocations } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const execute = vi.fn(async (action: unknown) => {
      void action;
      return { bookingId: "must_not_exist" };
    });
    const request = await signRequest(signers.flight, {
      requestId: "request_revoked_before_action_execution",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: { amount: 600, currency: "USD" },
      },
    });

    const evaluation = await evaluator.evaluate(chain, request);
    expect(evaluation.decision).toMatchObject({ allowed: true, code: "allowed" });
    expect(evaluation.receipt).toBeUndefined();
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
    if (!evaluation.actionGrant) throw new Error("Allowed action request lacks a grant");

    await revocations.revokeRoot(
      ROOT_CONSENT_ID,
      "Revoked after authorization but before execution",
      NOW,
    );
    const executeWithFinalCheck = async () => {
      const { action } = await actionConsumer.consume(evaluation.actionGrant!);
      return execute(action);
    };

    await expect(executeWithFinalCheck()).rejects.toMatchObject({
      code: "invalid_input",
      message: "Pass was revoked before action execution",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });
});
