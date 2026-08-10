import { beforeAll, describe, expect, it, vi } from "vitest";

import { DEMO_IDS, DEMO_NOW, createDemoRootConsent } from "../../demo/demo-fixtures";
import { createOpaqueDemoSessionId } from "../../demo/demo-session-cookie";
import { DeterministicDemoSignerProvider } from "../../demo/demo-signer-provider";
import {
  ActionExecutionService,
  ActionRequestSchema,
  AttenuationEngine,
  ChainVerifier,
  ContextDisclosureService,
  InMemoryPassportAdapter,
  InMemoryReceiptRepository,
  InMemoryTrustedRootKeyStore,
  PassSigner,
  PublicJwkSchema,
  ReceiptService,
  RootPassIssuer,
  UnsignedRelayPassSchema,
  VerifierRequestSchema,
  type ChildPassRequest,
  type RelayPass,
  type UnsignedRelayPass,
  type ValueConstraint,
} from "../index";
import {
  FLIGHT_PASS_ID,
  NOW,
  ROOT_CONSENT_ID,
  clone,
  createPolicyHarness,
  generateTestSigners,
  issueFlightChain,
  issueRoot,
  makeFlightRequest,
  makeRootConsent,
  makeStayRequest,
  signRequest,
  type TestSigners,
} from "./fixtures";

function unsigned(pass: RelayPass): UnsignedRelayPass {
  const candidate: Partial<RelayPass> = clone(pass);
  delete candidate.proof;
  return UnsignedRelayPassSchema.parse(candidate);
}

function corruptSignature(pass: RelayPass): RelayPass {
  const candidate = clone(pass);
  const segments = candidate.proof.jws.split(".");
  if (segments.length !== 3 || !segments[2]) throw new Error("Expected a compact JWS");
  segments[2] = `${segments[2][0] === "A" ? "B" : "A"}${segments[2].slice(1)}`;
  candidate.proof.jws = segments.join(".");
  return candidate;
}

describe("cryptographic adversarial matrix", () => {
  let signers: TestSigners;

  beforeAll(async () => {
    signers = await generateTestSigners();
  });

  it("rejects a modified root field even when the original JWS remains valid", async () => {
    const root = await issueRoot(signers);
    const modified = clone(root);
    modified.purpose.statement = "Tampered display statement";
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([modified], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_signature" });
  });

  it("rejects a modified child capability even when the original JWS remains valid", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const modified = clone(flight);
    const capability = modified.authority.allowedActions[0];
    if (!capability) throw new Error("Expected a flight capability");
    capability.constraints.amount = { kind: "max", value: 649 };
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, modified], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_signature" });
  });

  it("rejects a validly signed child with a fake parentPassId", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const candidate = unsigned(flight);
    candidate.parentPassId = "rp_attacker_parent";
    const malicious = await signers.nova.sign(candidate);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, malicious], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_chain" });
  });

  it("rejects a child signed by an agent other than the bound parent delegate", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const candidate = unsigned(flight);
    candidate.issuer.id = signers.stay.issuerId;
    const malicious = await signers.stay.sign(candidate);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, malicious], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_chain" });
  });

  it("rejects delegate-key substitution after a child has been signed", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const impostor = await PassSigner.generate("agent-flight", "key_impostor_flight");
    const modified = clone(flight);
    modified.delegate.publicKey = PublicJwkSchema.parse(impostor.publicKey);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, modified], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_signature" });
  });

  it("rejects a request from an impostor with the same agent and key IDs", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const impostor = await PassSigner.generate("agent-flight", signers.flight.keyId);
    const request = await signRequest(impostor, {
      requestId: "request_impostor_same_ids",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });
    const { evaluator, receipts } = createPolicyHarness(signers, "service-airline");

    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "invalid_signature",
      semanticStatus: 401,
      disclosedContext: [],
    });
    expect(result.receipt).toBeUndefined();
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("rejects a leaf-signed request for the wrong task and records an authenticated refusal", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const request = await signRequest(signers.flight, {
      requestId: "request_wrong_task_id",
      passId: flight.passId,
      serviceId: "service-airline",
      taskId: "task_unrelated",
      requestedContext: [],
    });
    const { evaluator } = createPolicyHarness(signers, "service-airline");

    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "wrong_purpose",
      semanticStatus: 403,
      disclosedContext: [],
    });
    expect(result.receipt).toMatchObject({
      agentId: "agent-flight",
      verifierId: "service-airline",
      taskId: "task_unrelated",
      decision: "refused",
      reason: "wrong_purpose",
    });
  });

  it("treats purpose statement as signed display text while enforcing taskId and scopes", async () => {
    const root = await issueRoot(signers);
    const request = clone(makeFlightRequest(signers));
    request.purpose.statement = "Different child display copy with no authority semantics";

    const child = await new AttenuationEngine(() => "rp_display_statement_child").derive(
      root,
      request,
      signers.nova,
    );

    expect(child.purpose.statement).toBe(request.purpose.statement);
    expect(child.purpose.taskId).toBe(root.purpose.taskId);
    expect(child.purpose.scopes.every((scope) => root.purpose.scopes.includes(scope))).toBe(true);
  });

  it("rejects a pass when its proof is removed", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const candidate: Partial<RelayPass> = clone(flight);
    delete candidate.proof;
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, candidate as RelayPass], {
      now: new Date(NOW),
    });

    expect(result).toMatchObject({ valid: false, code: "invalid_chain" });
  });

  it("rejects proof metadata algorithm substitution", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const candidate = clone(flight);
    (candidate.proof as { alg: string }).alg = "HS256";
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, candidate], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_chain" });
  });

  it("rejects protected-header algorithm substitution", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const candidate = clone(flight);
    const segments = candidate.proof.jws.split(".");
    if (segments.length !== 3) throw new Error("Expected a compact JWS");
    segments[0] = Buffer.from(
      JSON.stringify({ alg: "none", kid: candidate.proof.kid, typ: "relaypass+jws" }),
      "utf8",
    ).toString("base64url");
    candidate.proof.jws = segments.join(".");
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, candidate], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_signature" });
  });

  it("rejects malformed compact JWS input", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const candidate = clone(flight);
    candidate.proof.jws = "malformed.payload.signature";
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, candidate], { now: new Date(NOW) });

    expect(result).toMatchObject({ valid: false, code: "invalid_signature" });
  });

  it("rejects a request whose proof is removed without creating a receipt", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const signed = await signRequest(signers.flight, {
      requestId: "request_missing_proof",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
    });
    const candidate: Partial<typeof signed> = clone(signed);
    delete candidate.proof;
    const { evaluator, receipts } = createPolicyHarness(signers, "service-airline");

    const result = await evaluator.evaluate(chain, candidate as typeof signed);

    expect(result.decision).toMatchObject({ code: "invalid_request", disclosedContext: [] });
    expect(result.receipt).toBeUndefined();
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("rejects copied passes under another session or reset-generation trust anchor", async () => {
    const provider = new DeterministicDemoSignerProvider(
      "relaypass-adversarial-test-secret-with-more-than-thirty-two-bytes",
    );
    const sessionId = createOpaqueDemoSessionId();
    const [generationZero, otherSession, generationOne] = await Promise.all([
      provider.getSigners({ sessionId, generation: 0 }),
      provider.getSigners({ sessionId: createOpaqueDemoSessionId(), generation: 0 }),
      provider.getSigners({ sessionId, generation: 1 }),
    ]);
    const copiedRoot = await new RootPassIssuer(
      generationZero.rootIssuer,
      () => DEMO_IDS.rootPass,
    ).issue(createDemoRootConsent(generationZero));

    const verifierFor = (signer: PassSigner) => {
      const roots = new InMemoryTrustedRootKeyStore();
      roots.register(signer.issuerId, signer.keyId, signer.publicKey);
      return new ChainVerifier(roots);
    };
    const valid = await verifierFor(generationZero.rootIssuer).verify([copiedRoot], {
      now: new Date(DEMO_NOW),
    });
    const otherSessionResult = await verifierFor(otherSession.rootIssuer).verify([copiedRoot], {
      now: new Date(DEMO_NOW),
    });
    const nextGenerationResult = await verifierFor(generationOne.rootIssuer).verify([copiedRoot], {
      now: new Date(DEMO_NOW),
    });

    expect(valid.valid).toBe(true);
    expect(otherSessionResult).toMatchObject({ valid: false, code: "untrusted_root" });
    expect(nextGenerationResult).toMatchObject({ valid: false, code: "untrusted_root" });
  });

  it("bounds malicious collections, scalar strings, proofs, hashes, and chain length", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const request = await signRequest(signers.flight, {
      requestId: "request_size_bound",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
    });
    const oversizedScopes = clone(request);
    oversizedScopes.purposeScopes = Array.from(
      { length: 129 },
      (_, index) => `scope.${index}`,
    );
    const oversizedProof = clone(request);
    oversizedProof.proof.jws = "A".repeat(65_537);
    const oversizedHash = unsigned(flight) as UnsignedRelayPass & { parentPassHash: string };
    oversizedHash.parentPassHash = "A".repeat(10_000);
    const oversizedAction = {
      name: "flight.book",
      target: "airline.simulated",
      arguments: { note: "A".repeat(2_001) },
    };
    const { chainVerifier } = createPolicyHarness(signers);
    const excessiveChain = Array.from({ length: 18 }, () => root);

    expect(VerifierRequestSchema.safeParse(oversizedScopes).success).toBe(false);
    expect(VerifierRequestSchema.safeParse(oversizedProof).success).toBe(false);
    expect(UnsignedRelayPassSchema.safeParse(oversizedHash).success).toBe(false);
    expect(ActionRequestSchema.safeParse(oversizedAction).success).toBe(false);
    await expect(
      chainVerifier.verify(excessiveChain, { now: new Date(NOW) }),
    ).resolves.toMatchObject({ valid: false, code: "invalid_chain" });
  });

  it("rejects Unicode control characters in machine IDs and argument keys", async () => {
    const { flight } = await issueFlightChain(signers);
    const request = await signRequest(signers.flight, {
      requestId: "request_unicode_boundary",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
    });
    const weirdService = clone(request);
    weirdService.serviceId = "service-\u202Eattacker";
    const weirdAction = {
      name: "flight.book",
      target: "airline.simulated",
      arguments: JSON.parse('{"\u202Eamount":600}') as Record<string, number>,
    };

    expect(VerifierRequestSchema.safeParse(weirdService).success).toBe(false);
    expect(ActionRequestSchema.safeParse(weirdAction).success).toBe(false);
  });
});

describe("attenuation adversarial matrix", () => {
  let signers: TestSigners;

  beforeAll(async () => {
    signers = await generateTestSigners();
  });

  const requestEscalations: Array<[
    string,
    (request: ChildPassRequest, signers: TestSigners) => void,
    string,
  ]> = [
    [
      "proposed write set",
      (request) => request.context.proposeWrites.push("profile.profile_note"),
      "proposed write set expanded",
    ],
    [
      "agent audience",
      (request) => request.audience.allowedAgents.push("agent-attacker"),
      "agent audience expanded",
    ],
    [
      "task identity",
      (request) => {
        request.purpose.taskId = "task_unrelated";
      },
      "task id changed",
    ],
    [
      "delegate outside the parent audience",
      (request) => {
        request.delegate.agentId = "agent-attacker";
        request.delegate.displayName = "AttackerAgent";
      },
      "child delegate is outside the parent's agent audience",
    ],
    [
      "same-agent delegation boundary",
      (request, availableSigners) => {
        request.delegate = {
          agentId: availableSigners.nova.issuerId,
          displayName: "Nova",
          keyId: availableSigners.nova.keyId,
          publicKey: PublicJwkSchema.parse(availableSigners.nova.publicKey),
        };
      },
      "child delegate must cross an agent boundary",
    ],
  ];

  it.each(requestEscalations)("rejects expansion of %s", async (_, mutate, issue) => {
    const root = await issueRoot(signers);
    const request = clone(makeStayRequest(signers));
    mutate(request, signers);

    await expect(
      new AttenuationEngine(() => "rp_rejected_request_escalation").derive(
        root,
        request,
        signers.nova,
      ),
    ).rejects.toMatchObject({
      code: "invalid_derivation",
      details: expect.arrayContaining([issue]),
    });
  });

  const constraintEscalations: Array<[string, ValueConstraint, ValueConstraint]> = [
    ["minimum", { kind: "min", value: 2 }, { kind: "min", value: 1 }],
    [
      "enumeration",
      { kind: "oneOf", values: ["quiet", "standard"] },
      { kind: "oneOf", values: ["quiet", "party"] },
    ],
    ["exact value", { kind: "exact", value: "USD" }, { kind: "exact", value: "CAD" }],
    [
      "pattern",
      { kind: "pattern", value: "^[A-Z]{3}$" },
      { kind: "pattern", value: ".*" },
    ],
    ["constraint kind", { kind: "max", value: 10 }, { kind: "min", value: 10 }],
  ];

  it.each(constraintEscalations)(
    "rejects a broader %s constraint",
    async (_, parentConstraint, childConstraint) => {
      const consent = clone(makeRootConsent(signers));
      const rootHotel = consent.authority.allowedActions.find(
        ({ action }) => action === "hotel.book",
      );
      if (!rootHotel) throw new Error("Expected root hotel capability");
      rootHotel.constraints.policy = parentConstraint;
      const root = await new RootPassIssuer(
        signers.rootIssuer,
        () => "rp_constraint_root",
      ).issue(consent);
      const request = clone(makeStayRequest(signers));
      const childHotel = request.authority.allowedActions.find(
        ({ action }) => action === "hotel.book",
      );
      if (!childHotel) throw new Error("Expected child hotel capability");
      childHotel.constraints.policy = childConstraint;

      await expect(
        new AttenuationEngine(() => "rp_rejected_constraint").derive(
          root,
          request,
          signers.nova,
        ),
      ).rejects.toMatchObject({
        code: "invalid_derivation",
        details: expect.arrayContaining(["action hotel.book broadens constraint policy"]),
      });
    },
  );

  const signedEdgeEscalations: Array<[
    string,
    (candidate: UnsignedRelayPass) => void,
  ]> = [
    [
      "root consent",
      (candidate) => {
        candidate.rootConsentId = "consent_attacker";
        candidate.revocation.rootConsentId = "consent_attacker";
      },
    ],
    [
      "holder identity",
      (candidate) => {
        candidate.holder.pairwiseId = "holder_attacker";
      },
    ],
    [
      "delegation depth",
      (candidate) => {
        candidate.delegation.depth = 2;
      },
    ],
    [
      "receipt requirements",
      (candidate) => {
        candidate.receiptPolicy.reads = false;
      },
    ],
  ];

  it.each(signedEdgeEscalations)(
    "rejects a validly signed child that changes %s",
    async (_, mutate) => {
      const { root, flight } = await issueFlightChain(signers);
      const candidate = unsigned(flight);
      mutate(candidate);
      const malicious = await signers.nova.sign(candidate);
      const { chainVerifier } = createPolicyHarness(signers);

      const result = await chainVerifier.verify([root, malicious], { now: new Date(NOW) });

      expect(result).toMatchObject({ valid: false, code: "invalid_chain" });
    },
  );

  it("rejects derivation when the parent has disabled delegation", async () => {
    const root = await issueRoot(signers);
    const locked = unsigned(root);
    locked.delegation.allowed = false;
    const signedLockedRoot = await signers.rootIssuer.sign(locked);

    await expect(
      new AttenuationEngine(() => "rp_must_not_exist").derive(
        signedLockedRoot,
        makeStayRequest(signers),
        signers.nova,
      ),
    ).rejects.toMatchObject({
      code: "invalid_derivation",
      details: expect.arrayContaining(["parent prohibits delegation"]),
    });
  });
});

describe("typed action constraints", () => {
  let signers: TestSigners;
  let chain: readonly [RelayPass, RelayPass];
  let flight: RelayPass;

  beforeAll(async () => {
    signers = await generateTestSigners();
    const consent = clone(makeRootConsent(signers));
    const rootFlight = consent.authority.allowedActions.find(
      ({ action }) => action === "flight.book",
    );
    if (!rootFlight) throw new Error("Expected root flight capability");
    Object.assign(rootFlight.constraints, {
      minimumNights: { kind: "min", value: 2 },
      fareClass: { kind: "oneOf", values: ["economy", "premium"] },
      bookingCode: { kind: "pattern", value: "^[A-Z]{3}$" },
    } satisfies Record<string, ValueConstraint>);
    const root = await new RootPassIssuer(signers.rootIssuer, () => "rp_typed_root").issue(
      consent,
    );
    const request = clone(makeFlightRequest(signers));
    const childFlight = request.authority.allowedActions.find(
      ({ action }) => action === "flight.book",
    );
    if (!childFlight) throw new Error("Expected child flight capability");
    Object.assign(childFlight.constraints, {
      minimumNights: { kind: "min", value: 3 },
      fareClass: { kind: "oneOf", values: ["economy"] },
      bookingCode: { kind: "pattern", value: "^[A-Z]{3}$" },
    } satisfies Record<string, ValueConstraint>);
    flight = await new AttenuationEngine(() => FLIGHT_PASS_ID).derive(
      root,
      request,
      signers.nova,
    );
    chain = [root, flight];
  });

  const invalidArguments: Array<[
    string,
    (argumentsValue: Record<string, string | number | boolean>) => void,
  ]> = [
    [
      "exact",
      (argumentsValue) => {
        argumentsValue.currency = "CAD";
      },
    ],
    [
      "minimum",
      (argumentsValue) => {
        argumentsValue.minimumNights = 1;
      },
    ],
    [
      "enumeration",
      (argumentsValue) => {
        argumentsValue.fareClass = "first";
      },
    ],
    [
      "pattern",
      (argumentsValue) => {
        argumentsValue.bookingCode = "abc";
      },
    ],
    [
      "missing argument",
      (argumentsValue) => {
        delete argumentsValue.currency;
      },
    ],
    [
      "extra argument",
      (argumentsValue) => {
        argumentsValue.vip = true;
      },
    ],
    // A string that merely looks numeric must not be coerced past a `max`
    // ceiling; the constraint check requires an actual number.
    [
      "numeric string amount",
      (argumentsValue) => {
        argumentsValue.amount = "600" as unknown as number;
      },
    ],
  ];

  it.each(invalidArguments)("refuses an action that violates %s policy", async (name, mutate) => {
    const argumentsValue: Record<string, string | number | boolean> = {
      amount: 600,
      currency: "USD",
      minimumNights: 3,
      fareClass: "economy",
      bookingCode: "ABC",
    };
    mutate(argumentsValue);
    const request = await signRequest(signers.flight, {
      requestId: `request_constraint_${name.replaceAll(" ", "_")}`,
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: argumentsValue,
      },
    });
    const { evaluator, actionConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const execute = vi.fn(async () => ({ bookingId: "must_not_exist" }));
    const service = new ActionExecutionService(evaluator, actionConsumer, receipts);

    const result = await service.authorizeAndExecute(chain, request, execute);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "constraint_violation",
      disclosedContext: [],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result.receipt).toMatchObject({
      event: "action_refused",
      decision: "refused",
      reason: "constraint_violation",
    });
  });

  // A hostile client can bypass the signer entirely and post a hand-built body.
  // Non-finite amounts must fail closed at request validation rather than slip
  // past a `max` ceiling on a comparison that returns false for NaN.
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("refuses a hand-built request whose amount is %s without attributing a receipt", async (
    label,
    amount,
  ) => {
    const request = await signRequest(signers.flight, {
      requestId: `request_nonfinite_${label.replace("-", "neg_")}`,
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: {
          amount: 600,
          currency: "USD",
          minimumNights: 3,
          fareClass: "economy",
          bookingCode: "ABC",
        },
      },
    });
    // Tamper after signing, exactly as an attacker posting raw JSON would.
    const tampered = clone(request);
    (tampered.action!.arguments as Record<string, unknown>).amount = amount;
    const { evaluator, actionConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const execute = vi.fn(async () => ({ bookingId: "must_not_exist" }));
    const service = new ActionExecutionService(evaluator, actionConsumer, receipts);

    const result = await service.authorizeAndExecute(chain, tampered, execute);

    expect(result.decision).toMatchObject({ allowed: false, disclosedContext: [] });
    expect(execute).not.toHaveBeenCalled();
    expect(result.receipt).toBeUndefined();
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });
});

describe("receipt integrity and minimum disclosure", () => {
  let signers: TestSigners;

  beforeAll(async () => {
    signers = await generateTestSigners();
  });

  it("does not let an unauthenticated request inject refusal receipt metadata", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const signed = await signRequest(signers.flight, {
      requestId: "request_receipt_injection",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });
    const malicious = clone(signed);
    malicious.passId = "rp_victim_other_pass";
    malicious.agentId = "agent-victim";
    malicious.serviceId = "service-victim";
    malicious.taskId = "task-victim";
    malicious.requestedContext = ["profile.home_address"];
    const { evaluator, receipts } = createPolicyHarness(signers, "service-airline");

    const result = await evaluator.evaluate(chain, malicious);

    expect(result.decision).toMatchObject({ code: "invalid_signature", disclosedContext: [] });
    expect(result.receipt).toBeUndefined();
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("uses canonical agent and verifier attribution for an authenticated wrong-audience receipt", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const request = await signRequest(signers.flight, {
      requestId: "request_signed_wrong_audience",
      passId: flight.passId,
      serviceId: "service-hotel",
      requestedContext: [],
    });
    const { evaluator } = createPolicyHarness(signers, "service-airline");

    const result = await evaluator.evaluate(chain, request);

    expect(result.decision).toMatchObject({ code: "wrong_audience", disclosedContext: [] });
    expect(result.receipt).toMatchObject({
      agentId: flight.delegate.agentId,
      verifierId: "service-airline",
      requestId: "request_signed_wrong_audience",
      decision: "refused",
      reason: "wrong_audience",
    });
  });

  it("keeps stored receipts unchanged when returned objects and nested arrays are mutated", async () => {
    const repository = new InMemoryReceiptRepository();
    const receipts = new ReceiptService(repository, () => "rr_immutable_test", () => new Date(NOW));
    await receipts.record({
      rootConsentId: ROOT_CONSENT_ID,
      passId: FLIGHT_PASS_ID,
      parentPassId: "rp_root_maya_nova",
      agentId: "agent-flight",
      verifierId: "service-airline",
      requestId: "request_immutable_receipt",
      taskId: "task_maya_sf_trip",
      purposeScopes: ["travel.book"],
      event: "context_refused",
      decision: "refused",
      reason: "unauthorized_context",
      requestedContext: ["profile.home_address"],
      disclosedContext: [],
    });

    const firstRead = await repository.listByRoot(ROOT_CONSENT_ID);
    const first = firstRead[0];
    if (!first) throw new Error("Expected a stored receipt");
    first.decision = "allowed";
    first.reason = "tampered";
    first.requestedContext.push("health.diagnosis");
    const secondRead = await repository.listByRoot(ROOT_CONSENT_ID);

    expect(secondRead).toEqual([
      expect.objectContaining({
        decision: "refused",
        reason: "unauthorized_context",
        requestedContext: ["profile.home_address"],
        disclosedContext: [],
      }),
    ]);
  });

  it("does not record action success when the external callback fails", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const request = await signRequest(signers.flight, {
      requestId: "request_external_action_failure",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: { amount: 600, currency: "USD" },
      },
    });
    const { evaluator, actionConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const service = new ActionExecutionService(evaluator, actionConsumer, receipts);

    await expect(
      service.authorizeAndExecute(chain, request, async () => {
        throw new Error("simulated merchant failure");
      }),
    ).rejects.toThrow("simulated merchant failure");
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("does not record context-read success when the Passport release fails", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [],
      contextConsumer,
      () => new Date(NOW),
    );
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "request_missing_passport_value",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });

    await expect(disclosure.authorizeAndRelease(chain, request)).rejects.toMatchObject({
      code: "invalid_input",
      message: "Passport memory is unavailable: travel.destination",
    });
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("blocks a mixed allowed-and-home-address request before any value lookup or partial release", async () => {
    const secretAddress = "18 Sensitive Street";
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        { path: "travel.destination", value: "San Francisco", sensitivity: "standard" },
        { path: "profile.home_address", value: secretAddress, sensitivity: "restricted" },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const releaseSpy = vi.spyOn(passport, "releaseAuthorizedContext");
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "request_mixed_home_address",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination", "profile.home_address"],
    });

    const result = await disclosure.authorizeAndRelease(chain, request);

    expect(result.decision).toMatchObject({
      allowed: false,
      code: "unauthorized_context",
      disclosedContext: [],
    });
    expect(result.context).toBeUndefined();
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secretAddress);
    expect(result.receipt).toMatchObject({
      requestedContext: ["travel.destination", "profile.home_address"],
      disclosedContext: [],
      decision: "refused",
    });
  });

  it("releases only the requested allowed value even when the adapter stores a diagnosis", async () => {
    const diagnosis = "Private diagnosis";
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        { path: "travel.destination", value: "San Francisco", sensitivity: "standard" },
        { path: "health.diagnosis", value: diagnosis, sensitivity: "restricted" },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "request_minimum_value_only",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });

    const result = await disclosure.authorizeAndRelease(chain, request);

    expect(result.context).toEqual({ "travel.destination": "San Francisco" });
    expect(result.context).not.toHaveProperty("health.diagnosis");
    expect(JSON.stringify(result.receipt)).not.toContain("San Francisco");
    expect(JSON.stringify(result)).not.toContain(diagnosis);
  });

  it("does not create receipts for a corrupted request signature", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const request = await signRequest(signers.flight, {
      requestId: "request_corrupted_receipt_boundary",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["profile.home_address"],
    });
    const { evaluator, receipts } = createPolicyHarness(signers, "service-airline");
    const candidate = clone(request);
    const segments = candidate.proof.jws.split(".");
    if (segments.length !== 3 || !segments[2]) throw new Error("Expected a compact JWS");
    segments[2] = `${segments[2][0] === "A" ? "B" : "A"}${segments[2].slice(1)}`;
    candidate.proof.jws = segments.join(".");

    const result = await evaluator.evaluate(chain, candidate);

    expect(result.decision).toMatchObject({ code: "invalid_signature", disclosedContext: [] });
    expect(result.receipt).toBeUndefined();
    expect(await receipts.listByRoot(ROOT_CONSENT_ID)).toEqual([]);
  });

  it("still rejects a corrupted pass signature before policy or receipt attribution", async () => {
    const { root, flight } = await issueFlightChain(signers);
    const { chainVerifier } = createPolicyHarness(signers);

    const result = await chainVerifier.verify([root, corruptSignature(flight)], {
      now: new Date(NOW),
    });

    expect(result).toMatchObject({ valid: false, code: "invalid_signature" });
  });
});
