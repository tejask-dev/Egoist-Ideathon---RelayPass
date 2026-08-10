import {
  ActionExecutionService,
  AttenuationEngine,
  ChainVerifier,
  ContextDisclosureService,
  DelegationService,
  InMemoryPassportAdapter,
  InMemoryReceiptRepository,
  InMemoryRequestReplayGuard,
  InMemoryRevocationRepository,
  InMemoryTrustedRootKeyStore,
  PolicyEvaluator,
  ReceiptService,
  RelayPassError,
  RevocationService,
  RootPassIssuer,
  createActionGrantAuthority,
  createContextGrantAuthority,
  type ActionRequest,
  type ChildPassRequest,
  type ContextReleaseGrant,
  type PassportAdapter,
  type RelayPass,
  type RelayReceipt,
  type VerifierDecision,
  type VerifierRequest,
} from "../relaypass";
import {
  DEFAULT_DEMO_TIMELINE,
  DEMO_IDS,
  DEMO_MEMORY_SEED,
  DEMO_PURPOSE,
  DEMO_ROOT_CONTEXT,
  MEMORY_PRESENTATION,
  createDemoChildRequests,
  createDemoRootConsent,
  createDemoSigners,
  createDemoTimeline,
  type DemoTimeline,
  type DemoSigners,
} from "./demo-fixtures";
import type {
  DemoAction,
  DemoContextAttackResult,
  DemoDecision,
  DemoDinnerResult,
  DemoFlightResult,
  DemoHotelAttackResult,
  DemoJourneyStep,
  DemoMemoryView,
  DemoReceiptView,
  DemoRelayNode,
  DemoRevokedRetryResult,
  DemoSnapshot,
  DemoStage,
  DemoTechnicalProof,
  DemoVerifierCheck,
} from "./types";

const AGENT_NAMES: Record<string, string> = {
  [DEMO_IDS.nova]: "Nova",
  [DEMO_IDS.flight]: "FlightAgent",
  [DEMO_IDS.stay]: "StayAgent",
  [DEMO_IDS.dinner]: "DinnerAgent",
  maya: "Maya",
};

const VERIFIER_NAMES: Record<string, string> = {
  [DEMO_IDS.issuer]: "RelayPass issuer",
  [DEMO_IDS.airline]: "Airline verifier",
  [DEMO_IDS.hotel]: "Hotel verifier",
  [DEMO_IDS.restaurant]: "Restaurant verifier",
  "relaypass-attenuation": "RelayPass attenuation engine",
  "relaypass-revocation": "RelayPass status service",
};

class InstrumentedPassportAdapter implements PassportAdapter {
  releaseCount = 0;

  constructor(private readonly inner: PassportAdapter) {}

  listMemoryMetadata() {
    return this.inner.listMemoryMetadata();
  }

  async releaseAuthorizedContext(grant: ContextReleaseGrant) {
    this.releaseCount += 1;
    return this.inner.releaseAuthorizedContext(grant);
  }
}

type DemoPasses = {
  root?: RelayPass;
  flight?: RelayPass;
  stay?: RelayPass;
  dinner?: RelayPass;
};

type DemoOutcomes = {
  flight?: DemoFlightResult;
  homeAddress?: DemoContextAttackResult;
  hotel?: DemoHotelAttackResult;
  dinner?: DemoDinnerResult;
  revokedRetry?: DemoRevokedRetryResult;
};

type DemoInfrastructure = {
  trustedRoots: InMemoryTrustedRootKeyStore;
  chainVerifier: ChainVerifier;
  revocations: RevocationService;
  receipts: ReceiptService;
  passport: InstrumentedPassportAdapter;
  evaluators: {
    airline: PolicyEvaluator;
    hotel: PolicyEvaluator;
    restaurant: PolicyEvaluator;
  };
  disclosures: {
    airline: ContextDisclosureService;
    restaurant: ContextDisclosureService;
  };
  actions: {
    airline: ActionExecutionService;
    hotel: ActionExecutionService;
  };
};

type DemoSession = {
  stage: DemoStage;
  consentRequested: boolean;
  passes: DemoPasses;
  outcomes: DemoOutcomes;
  memories: DemoMemoryView[];
  revokedAt?: string;
  lastError?: { code: string; message: string };
  flightSideEffectCount: number;
  hotelSideEffectCount: number;
  infrastructure: DemoInfrastructure;
};

class DemoRuntimePreconditionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DemoRuntimePreconditionError";
  }
}

export type DemoRuntimeTestState = {
  passes: DemoPasses;
  chains: {
    root: RelayPass[];
    flight: RelayPass[];
    stay: RelayPass[];
    dinner: RelayPass[];
  };
  receipts: RelayReceipt[];
  outcomes: DemoOutcomes;
  passportReleaseCount: number;
  sideEffects: {
    flightBookings: number;
    hotelBookings: number;
  };
  revocationStatuses: {
    root: boolean;
    flight: boolean;
    stay: boolean;
    dinner: boolean;
  };
};

export type WideningProbeResult = {
  rejected: boolean;
  code?: string;
  message?: string;
  passCountBefore: number;
  passCountAfter: number;
};

export type DinnerDiagnosisProbeResult = {
  decision: DemoDecision;
  disclosedContext: Record<string, string | number | boolean> | undefined;
  passportValueFetchCalled: boolean;
  receipt?: RelayReceipt;
};

function decisionView(decision: VerifierDecision): DemoDecision {
  return {
    allowed: decision.allowed,
    code: decision.code,
    semanticStatus: decision.semanticStatus,
    disclosedContext: [...decision.disclosedContext],
    message: decision.message,
    ...(decision.receiptId ? { receiptId: decision.receiptId } : {}),
  };
}

function constraintView(constraint: RelayPass["authority"]["allowedActions"][number]["constraints"][string]) {
  switch (constraint.kind) {
    case "exact":
      return `= ${String(constraint.value)}`;
    case "max":
      return `<= ${constraint.value}`;
    case "min":
      return `>= ${constraint.value}`;
    case "oneOf":
      return `one of ${constraint.values.map(String).join(", ")}`;
    case "pattern":
      return `matches ${constraint.value}`;
  }
}

function receiptView(receipt: RelayReceipt): DemoReceiptView {
  return {
    ...receipt,
    agentName: AGENT_NAMES[receipt.agentId] ?? receipt.agentId,
    verifierName: VERIFIER_NAMES[receipt.verifierId] ?? receipt.verifierId,
  };
}

function copyChildRequest(request: ChildPassRequest): ChildPassRequest {
  return JSON.parse(JSON.stringify(request)) as ChildPassRequest;
}

export class DemoRuntime {
  private session!: DemoSession;
  private operationQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly signers: DemoSigners,
    private readonly timeline: DemoTimeline,
  ) {}

  static async create(
    options: { signers?: DemoSigners; clockOrigin?: string } = {},
  ): Promise<DemoRuntime> {
    const runtime = new DemoRuntime(
      options.signers ?? (await createDemoSigners()),
      options.clockOrigin ? createDemoTimeline(options.clockOrigin) : DEFAULT_DEMO_TIMELINE,
    );
    await runtime.replaceSession();
    return runtime;
  }

  async initializeDemo(): Promise<DemoSnapshot> {
    return this.getSnapshot();
  }

  async requestRootConsent(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    this.requireActiveRootIfIssued();
    this.session.consentRequested = true;
    if (!this.session.passes.root) this.session.stage = "consent";
    return this.getSnapshot();
  }

  async approveRootPass(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    this.requireActiveRootIfIssued();
    this.session.consentRequested = true;
    if (this.session.passes.root) return this.getSnapshot();

    const issuer = new RootPassIssuer(this.signers.rootIssuer, () => DEMO_IDS.rootPass);
    const root = await issuer.issue(createDemoRootConsent(this.signers, this.timeline));
    const verified = await this.session.infrastructure.chainVerifier.verify([root], {
      expectedAgentId: DEMO_IDS.nova,
      now: this.clock(),
    });
    if (!verified.valid) {
      throw new RelayPassError("invalid_chain", verified.message);
    }

    this.session.passes.root = root;
    await this.session.infrastructure.receipts.record({
      rootConsentId: root.rootConsentId,
      passId: root.passId,
      parentPassId: null,
      agentId: DEMO_IDS.nova,
      verifierId: DEMO_IDS.issuer,
      requestId: "demo_root_consent_approved",
      taskId: DEMO_IDS.task,
      purposeScopes: [...root.purpose.scopes],
      event: "pass_issued",
      decision: "allowed",
      reason: "holder_approved_two_hour_root",
      requestedContext: [...root.context.read],
      disclosedContext: [],
    });
    this.session.stage = "root_active";
    return this.getSnapshot();
  }

  async deriveChildren(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    this.requireActiveRootIfIssued();
    const root = this.requireRoot();
    if (this.session.passes.flight && this.session.passes.stay && this.session.passes.dinner) {
      return this.getSnapshot();
    }

    const requests = createDemoChildRequests(this.signers, this.timeline);
    const derive = async (
      key: "flight" | "stay" | "dinner",
      passId: string,
      request: ChildPassRequest,
    ) => {
      const service = new DelegationService(
        this.session.infrastructure.chainVerifier,
        this.session.infrastructure.revocations,
        new AttenuationEngine(() => passId),
        () => this.clock(),
      );
      const child = await service.derive([root], request, this.signers.nova);
      const verification = await this.session.infrastructure.chainVerifier.verify([root, child], {
        expectedAgentId: child.delegate.agentId,
        expectedServiceId: child.audience.allowedServices[0],
        now: this.clock(),
      });
      if (!verification.valid) {
        throw new RelayPassError("invalid_chain", verification.message);
      }

      this.session.passes[key] = child;
      await this.session.infrastructure.receipts.record({
        rootConsentId: child.rootConsentId,
        passId: child.passId,
        parentPassId: child.parentPassId,
        agentId: child.delegate.agentId,
        verifierId: "relaypass-attenuation",
        requestId: `demo_derive_${key}`,
        taskId: child.purpose.taskId,
        purposeScopes: [...child.purpose.scopes],
        event: "pass_derived",
        decision: "allowed",
        reason: "child_scope_verified_no_broader_than_parent",
        requestedContext: [...child.context.read],
        disclosedContext: [],
      });
    };

    if (!this.session.passes.flight) {
      await derive("flight", DEMO_IDS.flightPass, requests.flight);
    }
    if (!this.session.passes.stay) {
      await derive("stay", DEMO_IDS.stayPass, requests.stay);
    }
    if (!this.session.passes.dinner) {
      await derive("dinner", DEMO_IDS.dinnerPass, requests.dinner);
    }
    this.session.stage = "children_active";
    return this.getSnapshot();
  }

  async verifyAndBookFlight(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    this.requireActiveRoot();
    if (this.session.outcomes.flight) return this.getSnapshot();
    const chain = this.requireChain("flight");
    const request = await this.signRequest(this.signers.flight, {
      requestId: "demo_flight_booking_authorized",
      passId: DEMO_IDS.flightPass,
      serviceId: DEMO_IDS.airline,
      purposeScopes: ["travel.book"],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: { amount: 612, currency: "USD" },
      },
    });
    const before = this.session.flightSideEffectCount;
    const result = await this.session.infrastructure.actions.airline.authorizeAndExecute(
      chain,
      request,
      async () => {
        this.session.flightSideEffectCount += 1;
        return {
          bookingId: "FL-4821",
          route: "YYZ to SFO",
          amount: 612,
          currency: "USD",
        };
      },
    );
    if (
      !result.decision.allowed ||
      result.decision.code !== "allowed" ||
      !result.execution ||
      this.session.flightSideEffectCount !== before + 1
    ) {
      throw new Error("The seeded flight booking did not produce the expected allowed execution");
    }
    const proof = await this.technicalProof(chain, "flight");
    this.session.outcomes.flight = {
      decision: decisionView(result.decision),
      checks: await this.flightChecks(chain, result.decision),
      ...(result.execution ? { booking: result.execution } : {}),
      sideEffectPerformed: this.session.flightSideEffectCount === before + 1,
      technicalProof: proof,
    };
    this.session.stage = "activity_recorded";
    return this.getSnapshot();
  }

  async runHomeAddressAttack(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    this.requireActiveRoot();
    if (this.session.outcomes.homeAddress) return this.getSnapshot();
    const chain = this.requireChain("flight");
    const request = await this.signRequest(this.signers.flight, {
      requestId: "demo_attack_home_address",
      passId: DEMO_IDS.flightPass,
      serviceId: DEMO_IDS.airline,
      purposeScopes: ["travel.book"],
      requestedContext: ["profile.home_address"],
    });
    const before = this.session.infrastructure.passport.releaseCount;
    const result = await this.session.infrastructure.disclosures.airline.authorizeAndRelease(
      chain,
      request,
    );
    if (
      result.decision.allowed ||
      result.decision.code !== "unauthorized_context" ||
      !result.receipt
    ) {
      throw new Error("The seeded home-address attack did not fail closed");
    }
    const releaseCalled = this.session.infrastructure.passport.releaseCount !== before;
    if (releaseCalled) {
      throw new Error("Passport release was called for unauthorized home-address context");
    }
    this.session.outcomes.homeAddress = {
      requestedPath: "profile.home_address",
      decision: decisionView(result.decision),
      sharedFields: 0,
      passportValueFetchCalled: false,
      receiptId: result.receipt.receiptId,
    };
    this.session.stage = "activity_recorded";
    return this.getSnapshot();
  }

  async runOverBudgetHotelAttack(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    this.requireActiveRoot();
    if (this.session.outcomes.hotel) return this.getSnapshot();
    const chain = this.requireChain("stay");
    const request = await this.signRequest(this.signers.stay, {
      requestId: "demo_attack_hotel_over_budget",
      passId: DEMO_IDS.stayPass,
      serviceId: DEMO_IDS.hotel,
      purposeScopes: ["travel.book"],
      action: {
        name: "hotel.book",
        target: "hotel.simulated",
        arguments: { amount: 260, currency: "USD" },
      },
    });
    const before = this.session.hotelSideEffectCount;
    const result = await this.session.infrastructure.actions.hotel.authorizeAndExecute(
      chain,
      request,
      async () => {
        this.session.hotelSideEffectCount += 1;
        return { bookingId: "HOTEL-MUST-NOT-EXIST" };
      },
    );
    if (
      result.decision.allowed ||
      result.decision.code !== "constraint_violation" ||
      !result.receipt
    ) {
      throw new Error("The seeded over-budget hotel action was not refused");
    }
    if (this.session.hotelSideEffectCount !== before) {
      throw new Error("The hotel side effect ran despite the signed limit");
    }
    this.session.outcomes.hotel = {
      requestedAmount: 260,
      authorizedMaximum: 220,
      decision: decisionView(result.decision),
      purchaseMade: false,
      receiptId: result.receipt.receiptId,
    };
    this.session.stage = "activity_recorded";
    return this.getSnapshot();
  }

  async runDinnerMinimumDisclosure(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    this.requireActiveRoot();
    if (this.session.outcomes.dinner) return this.getSnapshot();
    const chain = this.requireChain("dinner");
    const request = await this.signRequest(this.signers.dinner, {
      requestId: "demo_dinner_minimum_disclosure",
      passId: DEMO_IDS.dinnerPass,
      serviceId: DEMO_IDS.restaurant,
      purposeScopes: ["dining.plan"],
      requestedContext: [
        "calendar.required_arrival_time",
        "dietary.nut_free_required",
      ],
    });
    const result = await this.session.infrastructure.disclosures.restaurant.authorizeAndRelease(
      chain,
      request,
    );
    if (
      !result.decision.allowed ||
      result.decision.code !== "allowed" ||
      !result.context ||
      !result.receipt
    ) {
      throw new Error("The seeded minimum dinner disclosure was not authorized");
    }
    if (result.context["dietary.nut_free_required"] !== true) {
      throw new Error("DinnerAgent did not receive the required nut-free constraint");
    }
    if ("health.diagnosis" in result.context) {
      throw new Error("DinnerAgent received a diagnosis that was never delegated");
    }
    this.session.outcomes.dinner = {
      decision: decisionView(result.decision),
      disclosedContext: { ...result.context },
      requiredConstraint: true,
      diagnosisInPass: false,
      diagnosisDisclosed: false,
      receiptId: result.receipt.receiptId,
    };
    this.session.stage = "activity_recorded";
    return this.getSnapshot();
  }

  async getReceipts(): Promise<RelayReceipt[]> {
    return this.session.passes.root
      ? this.session.infrastructure.receipts.listByRoot(DEMO_IDS.consent)
      : [];
  }

  async revokeRoot(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    const root = this.requireRoot();
    if (this.session.revokedAt) return this.getSnapshot();
    await this.session.infrastructure.revocations.revokeRoot(
      root.rootConsentId,
      "Maya revoked Nova and every descendant",
      this.timeline.revokedAt,
    );
    await this.session.infrastructure.receipts.record({
      rootConsentId: root.rootConsentId,
      passId: root.passId,
      parentPassId: null,
      agentId: "maya",
      verifierId: "relaypass-revocation",
      requestId: "demo_revoke_nova_root",
      taskId: root.purpose.taskId,
      purposeScopes: [...root.purpose.scopes],
      event: "pass_revoked",
      decision: "allowed",
      reason: "holder_revoked_root_and_descendants",
      requestedContext: [],
      disclosedContext: [],
    });
    this.session.revokedAt = this.timeline.revokedAt;
    this.session.stage = "root_revoked";
    return this.getSnapshot();
  }

  async retryRevokedFlight(): Promise<DemoSnapshot> {
    this.session.lastError = undefined;
    if (this.session.outcomes.revokedRetry) return this.getSnapshot();
    if (!this.session.revokedAt) {
      throw new Error("Revoke Nova before retrying FlightAgent");
    }
    if (!this.session.passes.flight) {
      throw new DemoRuntimePreconditionError(
        "demo_precondition_failed",
        "Derive FlightAgent before retrying its revoked pass",
      );
    }
    const chain = this.requireChain("flight");
    const request = await this.signRequest(this.signers.flight, {
      requestId: "demo_flight_booking_after_revocation",
      passId: DEMO_IDS.flightPass,
      serviceId: DEMO_IDS.airline,
      purposeScopes: ["travel.book"],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: { amount: 612, currency: "USD" },
      },
    });
    const before = this.session.flightSideEffectCount;
    const result = await this.session.infrastructure.actions.airline.authorizeAndExecute(
      chain,
      request,
      async () => {
        this.session.flightSideEffectCount += 1;
        return { bookingId: "FLIGHT-MUST-NOT-EXIST" };
      },
    );
    if (result.decision.allowed || result.decision.code !== "relay_pass_revoked") {
      throw new Error("The revoked FlightAgent pass did not fail its fresh live status check");
    }
    if (this.session.flightSideEffectCount !== before) {
      throw new Error("The flight side effect ran after root revocation");
    }
    this.session.outcomes.revokedRetry = {
      decision: decisionView(result.decision),
      checks: await this.flightChecks(chain, result.decision),
      samePassId: true,
      sideEffectPerformed: false,
      technicalProof: await this.technicalProof(chain, "flight"),
    };
    this.session.stage = "retry_refused";
    return this.getSnapshot();
  }

  async resetDemo(): Promise<DemoSnapshot> {
    await this.replaceSession();
    return this.getSnapshot();
  }

  runDemoAction(action: DemoAction): Promise<DemoSnapshot> {
    const operation = this.operationQueue.then(async () => {
      void 0;
      return this.dispatch(action);
    });
    this.operationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async getSnapshot(): Promise<DemoSnapshot> {
    const receipts = (await this.getReceipts()).map(receiptView);
    return {
      version: "relaypass-demo/1",
      stage: this.session.stage,
      passport: {
        holder: "Maya",
        memoryCount: 42,
        sourceLabel: "Prototype PassportAdapter",
        memories: this.session.memories.map((memory) => ({ ...memory })),
      },
      consent: {
        requested: this.session.consentRequested,
        approved: Boolean(this.session.passes.root),
        who: "Nova",
        purpose: DEMO_PURPOSE,
        canSee: [
          "Origin city",
          "Destination",
          "Arrival / dinner timing",
          "Seat preference",
          "Trip budget",
          "Nut-free functional requirement",
          "Event area",
        ],
        canDo: [
          "Search trip options",
          "Book a flight up to $650",
          "Book a hotel up to $220",
          "Delegate only narrower trip subtasks",
        ],
        cannot: [
          "Read Maya's home address",
          "Read a diagnosis or medical explanation",
          "Read private host details, identity documents, credentials, or bank information",
          "Create a child broader than this permission",
        ],
        expires: "2 hours",
        delegation: "Nova may delegate narrower trip-specific work to the named specialists.",
      },
      relayTree: {
        nodes: await this.relayNodes(),
        visibleEquation: "42 \u2192 7 \u2192 5 / 3 / 2",
      },
      outcomes: { ...this.session.outcomes },
      receipts,
      revocation: {
        rootRevoked: Boolean(this.session.revokedAt),
        ...(this.session.revokedAt ? { revokedAt: this.session.revokedAt } : {}),
        message: this.session.revokedAt
          ? "The credentials still exist, but their authority no longer does."
          : "Revoking Nova ends every permission derived from this root.",
      },
      journey: this.journey(),
      ...(this.session.lastError ? { lastError: { ...this.session.lastError } } : {}),
    };
  }

  async getTestState(): Promise<DemoRuntimeTestState> {
    const rootChain = this.optionalChain("root");
    const flightChain = this.optionalChain("flight");
    const stayChain = this.optionalChain("stay");
    const dinnerChain = this.optionalChain("dinner");
    const revoked = async (chain: RelayPass[]) =>
      chain.length > 0
        ? (await this.session.infrastructure.revocations.checkChain(chain)).revoked
        : false;

    return {
      passes: { ...this.session.passes },
      chains: {
        root: rootChain,
        flight: flightChain,
        stay: stayChain,
        dinner: dinnerChain,
      },
      receipts: await this.getReceipts(),
      outcomes: { ...this.session.outcomes },
      passportReleaseCount: this.session.infrastructure.passport.releaseCount,
      sideEffects: {
        flightBookings: this.session.flightSideEffectCount,
        hotelBookings: this.session.hotelSideEffectCount,
      },
      revocationStatuses: {
        root: await revoked(rootChain),
        flight: await revoked(flightChain),
        stay: await revoked(stayChain),
        dinner: await revoked(dinnerChain),
      },
    };
  }

  async attemptWideningProbeForTest(): Promise<WideningProbeResult> {
    const root = this.requireRoot();
    const passCountBefore = Object.values(this.session.passes).filter(Boolean).length;
    const malicious = copyChildRequest(
      createDemoChildRequests(this.signers, this.timeline).flight,
    );
    // This is a valid child shape, but the field is outside the signed root read set.
    // It therefore reaches—and must be rejected by—the real attenuation comparison.
    malicious.context.read.push("travel.preferred_airport");

    try {
      const service = new DelegationService(
        this.session.infrastructure.chainVerifier,
        this.session.infrastructure.revocations,
        new AttenuationEngine(() => "rp_demo_malicious_must_not_exist"),
        () => this.clock(),
      );
      await service.derive([root], malicious, this.signers.nova);
      return {
        rejected: false,
        passCountBefore,
        passCountAfter: Object.values(this.session.passes).filter(Boolean).length,
      };
    } catch (error) {
      return {
        rejected: true,
        code: error instanceof RelayPassError ? error.code : "demo_error",
        message: error instanceof Error ? error.message : "Unknown widening failure",
        passCountBefore,
        passCountAfter: Object.values(this.session.passes).filter(Boolean).length,
      };
    }
  }

  /** Server/test-only proof that DinnerAgent cannot retrieve the medical rationale. */
  async attemptDinnerDiagnosisForTest(): Promise<DinnerDiagnosisProbeResult> {
    const chain = this.requireChain("dinner");
    const request = await this.signRequest(this.signers.dinner, {
      requestId: "demo_test_dinner_diagnosis",
      passId: DEMO_IDS.dinnerPass,
      serviceId: DEMO_IDS.restaurant,
      purposeScopes: ["dining.plan"],
      requestedContext: ["health.diagnosis"],
    });
    const before = this.session.infrastructure.passport.releaseCount;
    const result = await this.session.infrastructure.disclosures.restaurant.authorizeAndRelease(
      chain,
      request,
    );
    return {
      decision: decisionView(result.decision),
      disclosedContext: result.context,
      passportValueFetchCalled:
        this.session.infrastructure.passport.releaseCount !== before,
      ...(result.receipt ? { receipt: result.receipt } : {}),
    };
  }

  private clock(): Date {
    return new Date(this.timeline.now);
  }

  private async replaceSession(): Promise<void> {
    const revocations = new RevocationService(new InMemoryRevocationRepository());
    const trustedRoots = new InMemoryTrustedRootKeyStore();
    trustedRoots.register(
      this.signers.rootIssuer.issuerId,
      this.signers.rootIssuer.keyId,
      this.signers.rootIssuer.publicKey,
    );
    const chainVerifier = new ChainVerifier(trustedRoots);
    const contextAuthority = createContextGrantAuthority(revocations);
    const actionAuthority = createActionGrantAuthority(revocations, () => this.clock());
    const basePassport = new InMemoryPassportAdapter(
      DEMO_IDS.holder,
      DEMO_MEMORY_SEED,
      contextAuthority.consumer,
      () => this.clock(),
    );
    const passport = new InstrumentedPassportAdapter(basePassport);
    let receiptSequence = 0;
    const receipts = new ReceiptService(
      new InMemoryReceiptRepository(),
      () => `rr_demo_${String(++receiptSequence).padStart(3, "0")}`,
      () => new Date(Date.parse(this.timeline.now) + receiptSequence * 1_000),
    );
    const evaluator = (verifierId: string) =>
      new PolicyEvaluator(
        chainVerifier,
        revocations,
        receipts,
        verifierId,
        contextAuthority.issuer,
        actionAuthority.issuer,
        new InMemoryRequestReplayGuard(),
        () => this.clock(),
      );
    const airline = evaluator(DEMO_IDS.airline);
    const hotel = evaluator(DEMO_IDS.hotel);
    const restaurant = evaluator(DEMO_IDS.restaurant);
    const memories = (await passport.listMemoryMetadata()).map((memory) => {
      const presentation = MEMORY_PRESENTATION[memory.path] ?? {
        label: memory.path,
      };
      return {
        path: memory.path,
        label: presentation.label,
        category: memory.path.split(".")[0] ?? "other",
        sensitivity: memory.sensitivity,
        ...(presentation.displayValue ? { displayValue: presentation.displayValue } : {}),
        delegatedToNova: DEMO_ROOT_CONTEXT.includes(
          memory.path as (typeof DEMO_ROOT_CONTEXT)[number],
        ),
      } satisfies DemoMemoryView;
    });
    if (memories.length !== 42) {
      throw new Error(`Demo Passport must contain exactly 42 memories, received ${memories.length}`);
    }

    this.session = {
      stage: "passport",
      consentRequested: false,
      passes: {},
      outcomes: {},
      memories,
      flightSideEffectCount: 0,
      hotelSideEffectCount: 0,
      infrastructure: {
        trustedRoots,
        chainVerifier,
        revocations,
        receipts,
        passport,
        evaluators: { airline, hotel, restaurant },
        disclosures: {
          airline: new ContextDisclosureService(airline, passport, receipts),
          restaurant: new ContextDisclosureService(restaurant, passport, receipts),
        },
        actions: {
          airline: new ActionExecutionService(airline, actionAuthority.consumer, receipts),
          hotel: new ActionExecutionService(hotel, actionAuthority.consumer, receipts),
        },
      },
    };
  }

  private async dispatch(action: DemoAction): Promise<DemoSnapshot> {
    try {
      switch (action) {
        case "request_consent":
          return await this.requestRootConsent();
        case "approve":
          return await this.approveRootPass();
        case "derive":
          return await this.deriveChildren();
        case "verify_flight":
          return await this.verifyAndBookFlight();
        case "forbidden_context":
          return await this.runHomeAddressAttack();
        case "over_budget_hotel":
          return await this.runOverBudgetHotelAttack();
        case "dinner_disclosure":
          return await this.runDinnerMinimumDisclosure();
        case "revoke":
          return await this.revokeRoot();
        case "retry_revoked_flight":
          return await this.retryRevokedFlight();
        case "reset":
          return await this.resetDemo();
      }
    } catch (error) {
      this.session.lastError = {
        code:
          error instanceof RelayPassError || error instanceof DemoRuntimePreconditionError
            ? error.code
            : "demo_error",
        message: error instanceof Error ? error.message : "The demo action failed safely",
      };
      return this.getSnapshot();
    }
  }

  private requireRoot(): RelayPass {
    const root = this.session.passes.root;
    if (!root) throw new Error("Approve Nova's root permission first");
    return root;
  }

  private requireActiveRootIfIssued(): void {
    if (this.session.passes.root) this.requireActiveRoot();
  }

  private requireActiveRoot(): RelayPass {
    const root = this.requireRoot();
    if (this.session.revokedAt) {
      throw new DemoRuntimePreconditionError(
        "relay_pass_revoked",
        "Nova's root permission is revoked; reset the demo to begin a new consent run",
      );
    }
    return root;
  }

  private requireChain(kind: "flight" | "stay" | "dinner"): RelayPass[] {
    const root = this.requireRoot();
    const child = this.session.passes[kind];
    if (!child) throw new Error(`Derive ${kind} permission before using it`);
    return [root, child];
  }

  private optionalChain(kind: "root" | "flight" | "stay" | "dinner"): RelayPass[] {
    const root = this.session.passes.root;
    if (!root) return [];
    if (kind === "root") return [root];
    const child = this.session.passes[kind];
    return child ? [root, child] : [];
  }

  private async signRequest(
    signer: DemoSigners["flight"],
    input: {
      requestId: string;
      passId: string;
      serviceId: string;
      purposeScopes: string[];
      requestedContext?: string[];
      action?: ActionRequest;
    },
  ): Promise<VerifierRequest> {
    return signer.signVerifierRequest({
      requestId: input.requestId,
      passId: input.passId,
      agentId: signer.issuerId,
      serviceId: input.serviceId,
      taskId: DEMO_IDS.task,
      purposeScopes: input.purposeScopes,
      issuedAt: this.timeline.requestIssuedAt,
      expiresAt: this.timeline.requestExpiresAt,
      requestedContext: input.requestedContext ?? [],
      ...(input.action ? { action: input.action } : {}),
    });
  }

  private async technicalProof(
    chain: RelayPass[],
    node: "root" | "flight" | "stay" | "dinner",
  ): Promise<DemoTechnicalProof> {
    const pass = chain.at(-1)!;
    const verification = await this.session.infrastructure.chainVerifier.verify(chain, {
      expectedAgentId: pass.delegate.agentId,
      now: this.clock(),
    });
    const status = await this.session.infrastructure.revocations.checkChain(chain);
    return {
      passId: pass.passId,
      parentPassId: pass.parentPassId,
      rootConsentId: pass.rootConsentId,
      delegate: pass.delegate.displayName,
      audience: [...pass.audience.allowedServices],
      purposeScopes: [...pass.purpose.scopes],
      contextPaths: [...pass.context.read],
      capabilities: pass.authority.allowedActions.map((capability) => ({
        action: capability.action,
        targets: [...capability.targets],
        constraints: Object.fromEntries(
          Object.entries(capability.constraints).map(([key, constraint]) => [
            key,
            constraintView(constraint),
          ]),
        ),
      })),
      issuedAt: pass.lifecycle.validFrom,
      expiresAt: pass.lifecycle.validUntil,
      parentHash: pass.parentPassHash,
      signatureVerified: verification.valid,
      chainVerified: verification.valid,
      revocationStatus: status.revoked ? (node === "root" ? "revoked" : "invalid") : "active",
    };
  }

  private async flightChecks(
    chain: RelayPass[],
    decision: VerifierDecision,
  ): Promise<DemoVerifierCheck[]> {
    const leaf = chain.at(-1)!;
    const chainResult = await this.session.infrastructure.chainVerifier.verify(chain, {
      expectedAgentId: DEMO_IDS.flight,
      expectedServiceId: DEMO_IDS.airline,
      now: this.clock(),
    });
    const status = await this.session.infrastructure.revocations.checkChain(chain);
    const capability = leaf.authority.allowedActions.find(
      (candidate) => candidate.action === "flight.book",
    );
    const amount = capability?.constraints.amount;
    const items: Array<[string, string, boolean, string]> = [
      [
        "chain",
        "Signature and parent chain valid",
        chainResult.valid,
        chainResult.valid ? "Root and child signatures verified" : chainResult.message,
      ],
      [
        "delegate",
        "Delegate key bound to FlightAgent",
        leaf.delegate.agentId === DEMO_IDS.flight,
        "The signed request presenter matches the leaf delegate",
      ],
      [
        "audience",
        "Correct airline audience",
        leaf.audience.allowedServices.includes(DEMO_IDS.airline),
        "The receiving service is named by the child pass",
      ],
      [
        "purpose",
        "Purpose is within Maya's trip task",
        leaf.purpose.taskId === DEMO_IDS.task && leaf.purpose.scopes.includes("travel.book"),
        "Structured task and purpose scopes remain within the root",
      ],
      [
        "lifecycle",
        "Pass active and unexpired",
        this.clock().getTime() >= Date.parse(leaf.lifecycle.validFrom) &&
          this.clock().getTime() < Date.parse(leaf.lifecycle.validUntil),
        `Valid until ${leaf.lifecycle.validUntil}`,
      ],
      [
        "revocation",
        "Live root and branch status active",
        !status.revoked,
        status.revoked ? "Root consent is no longer active" : "Fresh status lookup returned active",
      ],
      [
        "context",
        "Requested context is within this pass",
        true,
        "This action-only request disclosed 0 Passport fields",
      ],
      [
        "action",
        "Flight booking action permitted",
        Boolean(capability),
        "flight.book targets the simulated airline only",
      ],
      [
        "constraint",
        "Flight total is at or below $650",
        amount?.kind === "max" && amount.value >= 612,
        decision.allowed ? "$612 satisfies the signed maximum" : decision.message,
      ],
    ];
    return items.map(([id, label, passed, detail]) => ({
      id,
      label,
      status: passed ? "passed" : "failed",
      detail,
    }));
  }

  private async relayNodes(): Promise<DemoRelayNode[]> {
    const root = this.session.passes.root;
    const flight = this.session.passes.flight;
    const stay = this.session.passes.stay;
    const dinner = this.session.passes.dinner;
    const revoked = Boolean(this.session.revokedAt);
    const proof = async (
      pass: RelayPass | undefined,
      node: "root" | "flight" | "stay" | "dinner",
    ) => {
      if (!pass || !root) return undefined;
      return this.technicalProof(node === "root" ? [root] : [root, pass], node);
    };
    const [rootProof, flightProof, stayProof, dinnerProof] = await Promise.all([
      proof(root, "root"),
      proof(flight, "flight"),
      proof(stay, "stay"),
      proof(dinner, "dinner"),
    ]);
    const childStatus = (pass: RelayPass | undefined) =>
      pass ? (revoked ? "invalid" : "active") : "not_issued";

    return [
      {
        id: "maya",
        name: "Maya",
        eyebrow: "AI Passport",
        parentId: null,
        visibleCount: 42,
        countLabel: "memories",
        status: "active",
        purpose: "Maya controls the full Passport context.",
        canSee: ["All 42 Passport memories"],
        cannotSee: [],
        canDo: ["Approve, narrow, or revoke agent access"],
        cannotDo: [],
        limits: ["No app has blanket access"],
        expiresAt: null,
        delegation: "Maya explicitly approves the root ceiling.",
      },
      {
        id: "nova",
        name: "Nova",
        eyebrow: "Root agent",
        parentId: "maya",
        visibleCount: 7,
        countLabel: "approved pieces",
        status: root ? (revoked ? "revoked" : "active") : "not_issued",
        purpose: DEMO_PURPOSE,
        canSee: [
          "Toronto origin",
          "San Francisco destination",
          "Arrival / dinner timing",
          "Aisle seat",
          "$900 trip budget",
          "Nut-free required",
          "Mission District",
        ],
        cannotSee: ["Home address", "Diagnosis", "Host details", "Identity", "Banking", "Credentials"],
        canDo: ["Search travel", "Book flight <= $650", "Book hotel <= $220"],
        cannotDo: ["Transfer money", "Share credentials", "Delegate broader authority"],
        limits: ["Two hours", "One delegation level", "Named trip purpose only"],
        expiresAt: root?.lifecycle.validUntil ?? this.timeline.validUntil,
        delegation: "May delegate narrower scopes to FlightAgent, StayAgent, and DinnerAgent.",
        ...(rootProof ? { technicalProof: rootProof } : {}),
      },
      {
        id: "flight",
        name: "FlightAgent",
        eyebrow: "Air specialist",
        parentId: "nova",
        visibleCount: 5,
        countLabel: "scoped permissions",
        status: childStatus(flight),
        purpose: "Find and book Maya's flight to San Francisco.",
        canSee: ["Toronto", "San Francisco", "Arrival before 6 PM", "Aisle seat"],
        cannotSee: ["Home address", "Health", "Dining need", "Event area", "Hotel budget", "Host details"],
        canDo: ["Book one simulated flight <= $650"],
        cannotDo: ["Book hotels", "Coordinate dinner", "Delegate again"],
        limits: ["$650 maximum", "Simulated airline only"],
        expiresAt: flight?.lifecycle.validUntil ?? this.timeline.childValidUntil,
        delegation: "No further delegation.",
        ...(flightProof ? { technicalProof: flightProof } : {}),
      },
      {
        id: "stay",
        name: "StayAgent",
        eyebrow: "Lodging specialist",
        parentId: "nova",
        visibleCount: 3,
        countLabel: "scoped permissions",
        status: childStatus(stay),
        purpose: "Find a stay near Maya's dinner.",
        canSee: ["San Francisco", "Mission District"],
        cannotSee: ["Home address", "Diagnosis", "Seat preference", "Host details", "Flight budget"],
        canDo: ["Book one simulated hotel <= $220"],
        cannotDo: ["Book flights", "Spend above $220", "Delegate again"],
        limits: ["$220 maximum", "Simulated hotel only"],
        expiresAt: stay?.lifecycle.validUntil ?? this.timeline.childValidUntil,
        delegation: "No further delegation.",
        ...(stayProof ? { technicalProof: stayProof } : {}),
      },
      {
        id: "dinner",
        name: "DinnerAgent",
        eyebrow: "Dining specialist",
        parentId: "nova",
        visibleCount: 2,
        countLabel: "context pieces",
        status: childStatus(dinner),
        purpose: "Coordinate a safe dinner near Maya's event.",
        canSee: ["Arrival / dinner timing", "Nut-free required"],
        cannotSee: ["Diagnosis", "Medical history", "Home address", "Flight details", "Trip budget", "Host details"],
        canDo: ["Use the minimum functional dining context"],
        cannotDo: ["Spend", "Book travel", "Delegate again"],
        limits: ["No payment authority", "Simulated restaurant only"],
        expiresAt: dinner?.lifecycle.validUntil ?? this.timeline.childValidUntil,
        delegation: "No further delegation.",
        ...(dinnerProof ? { technicalProof: dinnerProof } : {}),
      },
    ];
  }

  private journey(): DemoJourneyStep[] {
    const completion = [
      Boolean(this.session.passes.root),
      Boolean(this.session.passes.flight && this.session.passes.stay && this.session.passes.dinner),
      Boolean(this.session.outcomes.flight),
      Boolean(this.session.outcomes.homeAddress && this.session.outcomes.hotel),
      Boolean(this.session.outcomes.dinner),
      Boolean(this.session.revokedAt),
    ];
    const current = completion.findIndex((complete) => !complete);
    const definitions: Array<[DemoJourneyStep["id"], string]> = [
      ["permission", "Permission"],
      ["delegate", "Delegate"],
      ["verify", "Verify"],
      ["refuse", "Refuse"],
      ["receipts", "Receipts"],
      ["revoke", "Revoke"],
    ];
    return definitions.map(([id, label], index) => ({
      id,
      label,
      state: completion[index]
        ? "complete"
        : index === (current === -1 ? definitions.length - 1 : current)
          ? "current"
          : "upcoming",
    }));
  }
}
