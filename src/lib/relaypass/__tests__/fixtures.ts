import {
  AttenuationEngine,
  ChainVerifier,
  createActionGrantAuthority,
  createContextGrantAuthority,
  InMemoryReceiptRepository,
  InMemoryRequestReplayGuard,
  InMemoryRevocationRepository,
  InMemoryTrustedRootKeyStore,
  PassSigner,
  PolicyEvaluator,
  PublicJwkSchema,
  ReceiptService,
  RevocationService,
  RootPassIssuer,
  type AgentIdentity,
  type ChildPassRequest,
  type RelayPass,
  type RevocationRepository,
  type RootConsent,
  type UnsignedVerifierRequest,
  type VerifierRequest,
} from "../index";

export const VALID_FROM = "2026-08-09T12:00:00.000Z";
export const APPROVED_AT = "2026-08-09T12:05:00.000Z";
export const NOW = "2026-08-09T18:00:00.000Z";
export const ROOT_VALID_UNTIL = "2026-08-10T12:00:00.000Z";
export const CHILD_VALID_UNTIL = "2026-08-10T06:00:00.000Z";
export const GRANDCHILD_VALID_UNTIL = "2026-08-10T00:00:00.000Z";

export const ROOT_PASS_ID = "rp_root_maya_nova";
export const FLIGHT_PASS_ID = "rp_child_flight";
export const STAY_PASS_ID = "rp_child_stay";
export const SCOUT_PASS_ID = "rp_grandchild_hotel_scout";
export const ROOT_CONSENT_ID = "consent_maya_sf_trip";

export const ROOT_CONTEXT = [
  "travel.origin_city",
  "travel.destination",
  "calendar.required_arrival_time",
  "travel.seat_preference",
  "commerce.trip_budget",
  "dietary.nut_free_required",
  "trip.event_area",
];

export const NEVER_DISCLOSE = [
  "profile.home_address",
  "health.diagnosis",
  "relationships.host_private_details",
  "credentials.api_key",
  "finance.account_number",
];

export const STEP_UP_REQUIRED = ["commerce.payment_method"];
export const PROHIBITED_ACTIONS = ["finance.transfer", "credentials.share"];

export type TestSigners = {
  rootIssuer: PassSigner;
  nova: PassSigner;
  flight: PassSigner;
  stay: PassSigner;
  hotelScout: PassSigner;
};

export async function generateTestSigners(): Promise<TestSigners> {
  const [rootIssuer, nova, flight, stay, hotelScout] = await Promise.all([
    PassSigner.generate("relaypass-demo-issuer", "key_root_2026"),
    PassSigner.generate("agent-nova", "key_nova_2026"),
    PassSigner.generate("agent-flight", "key_flight_2026"),
    PassSigner.generate("agent-stay", "key_stay_2026"),
    PassSigner.generate("agent-hotel-scout", "key_hotel_scout_2026"),
  ]);

  return { rootIssuer, nova, flight, stay, hotelScout };
}

function identity(
  signer: PassSigner,
  agentId: string,
  displayName: string,
): AgentIdentity {
  return {
    agentId,
    displayName,
    keyId: signer.keyId,
    publicKey: PublicJwkSchema.parse(signer.publicKey),
  };
}

function inheritedContextRestrictions() {
  return {
    neverDisclose: [...NEVER_DISCLOSE],
    stepUpRequired: [...STEP_UP_REQUIRED],
  };
}

function inheritedProhibitions() {
  return [...PROHIBITED_ACTIONS];
}

export function makeRootConsent(signers: TestSigners): RootConsent {
  return {
    consentId: ROOT_CONSENT_ID,
    holderPairwiseId: "maya_pairwise_trip_2026",
    issuerId: signers.rootIssuer.issuerId,
    requester: identity(signers.nova, "agent-nova", "Nova"),
    audience: {
      allowedAgents: [
        "agent-flight",
        "agent-stay",
        "agent-hotel-scout",
      ],
      allowedServices: [
        "service-airline",
        "service-hotel",
        "service-restaurant",
      ],
    },
    purpose: {
      taskId: "task_maya_sf_trip",
      statement: "Arrange Maya's trip to San Francisco in time for dinner",
      scopes: ["travel.plan", "travel.book", "dining.plan"],
    },
    context: {
      read: [...ROOT_CONTEXT],
      proposeWrites: ["trip.itinerary_note"],
      ...inheritedContextRestrictions(),
    },
    authority: {
      allowedActions: [
        {
          action: "flight.book",
          targets: ["airline.simulated", "airline.backup"],
          constraints: {
            amount: { kind: "max", value: 650 },
            currency: { kind: "exact", value: "USD" },
          },
          requiresHumanApproval: false,
        },
        {
          action: "hotel.book",
          targets: ["hotel.simulated", "hotel.backup"],
          constraints: {
            amount: { kind: "max", value: 500 },
            currency: { kind: "exact", value: "USD" },
          },
          requiresHumanApproval: false,
        },
      ],
      prohibitedActions: inheritedProhibitions(),
    },
    maxDelegationDepth: 3,
    lifecycle: {
      validFrom: VALID_FROM,
      validUntil: ROOT_VALID_UNTIL,
    },
    approvedAt: APPROVED_AT,
  };
}

export function makeFlightRequest(signers: TestSigners): ChildPassRequest {
  return {
    delegate: identity(signers.flight, "agent-flight", "FlightAgent"),
    audience: {
      allowedAgents: [],
      allowedServices: ["service-airline"],
    },
    purpose: {
      taskId: "task_maya_sf_trip",
      statement: "Find and book a suitable flight",
      scopes: ["travel.book"],
    },
    context: {
      read: [
        "travel.origin_city",
        "travel.destination",
        "calendar.required_arrival_time",
        "travel.seat_preference",
      ],
      proposeWrites: [],
      ...inheritedContextRestrictions(),
    },
    authority: {
      allowedActions: [
        {
          action: "flight.book",
          targets: ["airline.simulated"],
          constraints: {
            amount: { kind: "max", value: 650 },
            currency: { kind: "exact", value: "USD" },
          },
          requiresHumanApproval: false,
        },
      ],
      prohibitedActions: inheritedProhibitions(),
    },
    delegation: {
      allowed: false,
      maxDepth: 2,
    },
    lifecycle: {
      validFrom: "2026-08-09T13:00:00.000Z",
      validUntil: CHILD_VALID_UNTIL,
    },
  };
}

export function makeStayRequest(signers: TestSigners): ChildPassRequest {
  return {
    delegate: identity(signers.stay, "agent-stay", "StayAgent"),
    audience: {
      allowedAgents: ["agent-hotel-scout"],
      allowedServices: ["service-hotel"],
    },
    purpose: {
      taskId: "task_maya_sf_trip",
      statement: "Find and book a hotel near the event",
      scopes: ["travel.book"],
    },
    context: {
      read: ["travel.destination", "trip.event_area"],
      proposeWrites: [],
      ...inheritedContextRestrictions(),
    },
    authority: {
      allowedActions: [
        {
          action: "hotel.book",
          targets: ["hotel.simulated"],
          constraints: {
            amount: { kind: "max", value: 220 },
            currency: { kind: "exact", value: "USD" },
          },
          requiresHumanApproval: false,
        },
      ],
      prohibitedActions: inheritedProhibitions(),
    },
    delegation: {
      allowed: true,
      maxDepth: 2,
    },
    lifecycle: {
      validFrom: "2026-08-09T13:00:00.000Z",
      validUntil: CHILD_VALID_UNTIL,
    },
  };
}

export function makeHotelScoutRequest(signers: TestSigners): ChildPassRequest {
  return {
    delegate: identity(signers.hotelScout, "agent-hotel-scout", "HotelScoutAgent"),
    audience: {
      allowedAgents: [],
      allowedServices: ["service-hotel"],
    },
    purpose: {
      taskId: "task_maya_sf_trip",
      statement: "Check hotel availability near the event",
      scopes: ["travel.book"],
    },
    context: {
      read: ["travel.destination"],
      proposeWrites: [],
      ...inheritedContextRestrictions(),
    },
    authority: {
      allowedActions: [],
      prohibitedActions: inheritedProhibitions(),
    },
    delegation: {
      allowed: false,
      maxDepth: 2,
    },
    lifecycle: {
      validFrom: "2026-08-09T14:00:00.000Z",
      validUntil: GRANDCHILD_VALID_UNTIL,
    },
  };
}

export async function issueRoot(
  signers: TestSigners,
  passId = ROOT_PASS_ID,
): Promise<RelayPass> {
  return new RootPassIssuer(signers.rootIssuer, () => passId).issue(
    makeRootConsent(signers),
  );
}

export async function issueFlightChain(signers: TestSigners) {
  const root = await issueRoot(signers);
  const flight = await new AttenuationEngine(() => FLIGHT_PASS_ID).derive(
    root,
    makeFlightRequest(signers),
    signers.nova,
  );
  return { root, flight, chain: [root, flight] as const };
}

export async function issueStayChain(signers: TestSigners) {
  const root = await issueRoot(signers);
  const stay = await new AttenuationEngine(() => STAY_PASS_ID).derive(
    root,
    makeStayRequest(signers),
    signers.nova,
  );
  return { root, stay, chain: [root, stay] as const };
}

export async function issueHotelScoutChain(signers: TestSigners) {
  const { root, stay } = await issueStayChain(signers);
  const hotelScout = await new AttenuationEngine(() => SCOUT_PASS_ID).derive(
    stay,
    makeHotelScoutRequest(signers),
    signers.stay,
  );
  return { root, stay, hotelScout, chain: [root, stay, hotelScout] as const };
}

export function createPolicyHarness(
  signers: TestSigners,
  verifierId = "service-airline",
  revocationRepository: RevocationRepository = new InMemoryRevocationRepository(),
  clock: () => Date = () => new Date(NOW),
) {
  const trustedRoots = new InMemoryTrustedRootKeyStore();
  trustedRoots.register(
    signers.rootIssuer.issuerId,
    signers.rootIssuer.keyId,
    signers.rootIssuer.publicKey,
  );

  const chainVerifier = new ChainVerifier(trustedRoots);
  const revocations = new RevocationService(revocationRepository);
  const contextGrants = createContextGrantAuthority(revocations);
  const actionGrants = createActionGrantAuthority(revocations, clock);
  const replayGuard = new InMemoryRequestReplayGuard();
  const receiptRepository = new InMemoryReceiptRepository();
  let receiptSequence = 0;
  const receipts = new ReceiptService(
    receiptRepository,
    () => `rr_test_${String(++receiptSequence).padStart(2, "0")}`,
  );

  return {
    chainVerifier,
    revocations,
    receipts,
    contextIssuer: contextGrants.issuer,
    contextConsumer: contextGrants.consumer,
    actionIssuer: actionGrants.issuer,
    actionConsumer: actionGrants.consumer,
    replayGuard,
    evaluator: new PolicyEvaluator(
      chainVerifier,
      revocations,
      receipts,
      verifierId,
      contextGrants.issuer,
      actionGrants.issuer,
      replayGuard,
      clock,
    ),
  };
}

type SignedRequestInput = {
  requestId: string;
  passId: string;
  serviceId: string;
  requestedContext: string[];
  taskId?: string;
  purposeScopes?: string[];
  issuedAt?: string;
  expiresAt?: string;
  action?: UnsignedVerifierRequest["action"];
};

export async function signRequest(
  signer: PassSigner,
  input: SignedRequestInput,
): Promise<VerifierRequest> {
  return signer.signVerifierRequest({
    requestId: input.requestId,
    passId: input.passId,
    agentId: signer.issuerId,
    serviceId: input.serviceId,
    taskId: input.taskId ?? "task_maya_sf_trip",
    purposeScopes: input.purposeScopes ?? ["travel.book"],
    issuedAt: input.issuedAt ?? "2026-08-09T17:58:00.000Z",
    expiresAt: input.expiresAt ?? "2026-08-09T18:02:00.000Z",
    requestedContext: input.requestedContext,
    action: input.action,
  });
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
