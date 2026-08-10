import {
  PassSigner,
  PublicJwkSchema,
  type AgentIdentity,
  type ChildPassRequest,
  type PassportMemory,
  type RootConsent,
} from "../relaypass";

export const DEMO_NOW = "2026-08-09T18:00:00.000Z";
export const DEMO_VALID_UNTIL = "2026-08-09T20:00:00.000Z";
export const DEMO_CHILD_VALID_UNTIL = "2026-08-09T19:30:00.000Z";

export type DemoTimeline = {
  now: string;
  validUntil: string;
  childValidUntil: string;
  requestIssuedAt: string;
  requestExpiresAt: string;
  revokedAt: string;
};

export function createDemoTimeline(origin = DEMO_NOW): DemoTimeline {
  const originMs = Date.parse(origin);
  if (!Number.isFinite(originMs)) {
    throw new Error("Demo clock origin must be a valid ISO timestamp");
  }

  return {
    now: new Date(originMs).toISOString(),
    validUntil: new Date(originMs + 2 * 60 * 60 * 1_000).toISOString(),
    childValidUntil: new Date(originMs + 90 * 60 * 1_000).toISOString(),
    requestIssuedAt: new Date(originMs - 60 * 1_000).toISOString(),
    requestExpiresAt: new Date(originMs + 4 * 60 * 1_000).toISOString(),
    revokedAt: new Date(originMs + 60 * 1_000).toISOString(),
  };
}

export const DEFAULT_DEMO_TIMELINE = createDemoTimeline();

export const DEMO_IDS = {
  issuer: "relaypass-demo-issuer",
  issuerKey: "key_relaypass_demo_2026",
  holder: "maya_pairwise_sf_dinner",
  consent: "consent_maya_sf_dinner",
  task: "task_maya_sf_dinner",
  rootPass: "rp_demo_nova_root",
  flightPass: "rp_demo_flight_child",
  stayPass: "rp_demo_stay_child",
  dinnerPass: "rp_demo_dinner_child",
  nova: "agent-nova",
  flight: "agent-flight",
  stay: "agent-stay",
  dinner: "agent-dinner",
  airline: "service-airline",
  hotel: "service-hotel",
  restaurant: "service-restaurant",
} as const;

export const DEMO_PURPOSE =
  "Coordinate Maya's San Francisco trip for tomorrow's dinner.";

export const DEMO_ROOT_CONTEXT = [
  "travel.origin_city",
  "travel.destination",
  "calendar.required_arrival_time",
  "travel.seat_preference",
  "commerce.trip_budget",
  "dietary.nut_free_required",
  "trip.event_area",
] as const;

export const DEMO_NEVER_DISCLOSE = [
  "profile.home_address",
  "health.diagnosis",
  "health.medications",
  "relationships.host_private_details",
  "relationships.host_email",
  "identity.government_id",
  "identity.passport_number",
  "financial.bank_information",
  "financial.account_number",
  "credentials.email_password",
  "credentials.api_key",
  "credentials.recovery_codes",
  "work.confidential_notes",
] as const;

export const DEMO_STEP_UP = ["commerce.payment_method"] as const;

export const DEMO_PROHIBITED_ACTIONS = [
  "finance.transfer",
  "credentials.share",
  "messages.send_unrelated",
] as const;

export const DEMO_MEMORY_SEED = [
  { path: "travel.origin_city", value: "Toronto", sensitivity: "standard" },
  { path: "travel.destination", value: "San Francisco", sensitivity: "standard" },
  { path: "travel.preferred_airport", value: "YYZ", sensitivity: "standard" },
  { path: "travel.seat_preference", value: "aisle", sensitivity: "standard" },
  { path: "travel.airline_status", value: "Gold", sensitivity: "sensitive" },
  { path: "travel.passport_expiry", value: "2028-02", sensitivity: "sensitive" },
  {
    path: "calendar.required_arrival_time",
    value: "Tomorrow, 6:00 PM",
    sensitivity: "standard",
  },
  { path: "calendar.dinner_time", value: "Tomorrow, 8:00 PM", sensitivity: "standard" },
  { path: "calendar.timezone", value: "America/Toronto", sensitivity: "standard" },
  {
    path: "calendar.work_focus_block",
    value: "Tomorrow morning",
    sensitivity: "sensitive",
  },
  { path: "commerce.trip_budget", value: 900, sensitivity: "sensitive" },
  { path: "commerce.flight_budget", value: 650, sensitivity: "sensitive" },
  { path: "commerce.hotel_budget", value: 220, sensitivity: "sensitive" },
  { path: "commerce.currency", value: "USD", sensitivity: "standard" },
  { path: "commerce.payment_method", value: "Card on file", sensitivity: "restricted" },
  { path: "trip.event_area", value: "Mission District", sensitivity: "standard" },
  { path: "trip.hotel_style", value: "Quiet boutique", sensitivity: "standard" },
  { path: "trip.transport_preference", value: "Public transit", sensitivity: "standard" },
  { path: "dietary.nut_free_required", value: true, sensitivity: "sensitive" },
  { path: "dietary.vegetarian_preferred", value: false, sensitivity: "standard" },
  { path: "profile.home_address", value: "18 Sensitive Street", sensitivity: "restricted" },
  { path: "profile.phone_number", value: "+1 416 555 0100", sensitivity: "sensitive" },
  { path: "profile.legal_name", value: "Maya Chen", sensitivity: "sensitive" },
  { path: "profile.language", value: "English", sensitivity: "standard" },
  { path: "health.diagnosis", value: "Private diagnosis", sensitivity: "restricted" },
  { path: "health.medications", value: "Private medications", sensitivity: "restricted" },
  { path: "health.emergency_contact", value: "Private contact", sensitivity: "restricted" },
  {
    path: "relationships.host_private_details",
    value: "Private host details",
    sensitivity: "restricted",
  },
  { path: "relationships.host_email", value: "private@example.test", sensitivity: "restricted" },
  { path: "relationships.partner_name", value: "Private", sensitivity: "sensitive" },
  { path: "identity.government_id", value: "PRIVATE-ID", sensitivity: "restricted" },
  { path: "identity.passport_number", value: "PRIVATE-PASSPORT", sensitivity: "restricted" },
  { path: "identity.date_of_birth", value: "1990-01-01", sensitivity: "restricted" },
  { path: "financial.bank_information", value: "PRIVATE-BANK", sensitivity: "restricted" },
  { path: "financial.account_number", value: "PRIVATE-ACCOUNT", sensitivity: "restricted" },
  { path: "credentials.email_password", value: "PRIVATE-PASSWORD", sensitivity: "restricted" },
  { path: "credentials.api_key", value: "PRIVATE-API-KEY", sensitivity: "restricted" },
  { path: "credentials.recovery_codes", value: "PRIVATE-CODES", sensitivity: "restricted" },
  { path: "work.current_project", value: "Relay launch", sensitivity: "sensitive" },
  { path: "work.client_name", value: "Private client", sensitivity: "sensitive" },
  { path: "work.confidential_notes", value: "Private notes", sensitivity: "restricted" },
  { path: "preferences.room_temperature", value: "20\u00b0C", sensitivity: "standard" },
] as const satisfies readonly PassportMemory[];

export const MEMORY_PRESENTATION: Record<
  string,
  { label: string; displayValue?: string }
> = {
  "travel.origin_city": { label: "Origin city", displayValue: "Toronto" },
  "travel.destination": { label: "Destination", displayValue: "San Francisco" },
  "travel.preferred_airport": { label: "Preferred airport", displayValue: "YYZ" },
  "travel.seat_preference": { label: "Seat preference", displayValue: "Aisle" },
  "travel.airline_status": { label: "Airline status" },
  "travel.passport_expiry": { label: "Passport expiry" },
  "calendar.required_arrival_time": {
    label: "Arrival / dinner timing",
    displayValue: "Tomorrow, before 6 PM",
  },
  "calendar.dinner_time": { label: "Dinner time", displayValue: "Tomorrow, 8 PM" },
  "calendar.timezone": { label: "Timezone", displayValue: "Toronto" },
  "calendar.work_focus_block": { label: "Work focus block" },
  "commerce.trip_budget": { label: "Trip budget", displayValue: "$900" },
  "commerce.flight_budget": { label: "Flight budget", displayValue: "$650" },
  "commerce.hotel_budget": { label: "Hotel budget", displayValue: "$220" },
  "commerce.currency": { label: "Currency", displayValue: "USD" },
  "commerce.payment_method": { label: "Payment method" },
  "trip.event_area": { label: "Event area", displayValue: "Mission District" },
  "trip.hotel_style": { label: "Hotel style", displayValue: "Quiet boutique" },
  "trip.transport_preference": { label: "Local transport", displayValue: "Public transit" },
  "dietary.nut_free_required": { label: "Nut-free required", displayValue: "Yes" },
  "dietary.vegetarian_preferred": { label: "Vegetarian preference", displayValue: "No" },
  "profile.home_address": { label: "Home address" },
  "profile.phone_number": { label: "Phone number" },
  "profile.legal_name": { label: "Legal name" },
  "profile.language": { label: "Language", displayValue: "English" },
  "health.diagnosis": { label: "Diagnosis" },
  "health.medications": { label: "Medications" },
  "health.emergency_contact": { label: "Emergency contact" },
  "relationships.host_private_details": { label: "Host private details" },
  "relationships.host_email": { label: "Host email" },
  "relationships.partner_name": { label: "Partner name" },
  "identity.government_id": { label: "Government ID" },
  "identity.passport_number": { label: "Passport number" },
  "identity.date_of_birth": { label: "Date of birth" },
  "financial.bank_information": { label: "Bank information" },
  "financial.account_number": { label: "Account number" },
  "credentials.email_password": { label: "Email password" },
  "credentials.api_key": { label: "API key" },
  "credentials.recovery_codes": { label: "Recovery codes" },
  "work.current_project": { label: "Current project" },
  "work.client_name": { label: "Client name" },
  "work.confidential_notes": { label: "Confidential work notes" },
  "preferences.room_temperature": { label: "Room temperature", displayValue: "20\u00b0C" },
};

export type DemoSigners = {
  rootIssuer: PassSigner;
  nova: PassSigner;
  flight: PassSigner;
  stay: PassSigner;
  dinner: PassSigner;
};

export async function createDemoSigners(): Promise<DemoSigners> {
  const [rootIssuer, nova, flight, stay, dinner] = await Promise.all([
    PassSigner.generate(DEMO_IDS.issuer, DEMO_IDS.issuerKey),
    PassSigner.generate(DEMO_IDS.nova, "key_nova_demo_2026"),
    PassSigner.generate(DEMO_IDS.flight, "key_flight_demo_2026"),
    PassSigner.generate(DEMO_IDS.stay, "key_stay_demo_2026"),
    PassSigner.generate(DEMO_IDS.dinner, "key_dinner_demo_2026"),
  ]);
  return { rootIssuer, nova, flight, stay, dinner };
}

function identity(signer: PassSigner, displayName: string): AgentIdentity {
  return {
    agentId: signer.issuerId,
    displayName,
    keyId: signer.keyId,
    publicKey: PublicJwkSchema.parse(signer.publicKey),
  };
}

function restrictions() {
  return {
    neverDisclose: [...DEMO_NEVER_DISCLOSE],
    stepUpRequired: [...DEMO_STEP_UP],
  };
}

function prohibitedActions() {
  return [...DEMO_PROHIBITED_ACTIONS];
}

export function createDemoRootConsent(
  signers: DemoSigners,
  timeline: DemoTimeline = DEFAULT_DEMO_TIMELINE,
): RootConsent {
  return {
    consentId: DEMO_IDS.consent,
    holderPairwiseId: DEMO_IDS.holder,
    issuerId: DEMO_IDS.issuer,
    requester: identity(signers.nova, "Nova"),
    audience: {
      allowedAgents: [DEMO_IDS.flight, DEMO_IDS.stay, DEMO_IDS.dinner],
      allowedServices: [DEMO_IDS.airline, DEMO_IDS.hotel, DEMO_IDS.restaurant],
    },
    purpose: {
      taskId: DEMO_IDS.task,
      statement: DEMO_PURPOSE,
      scopes: ["travel.plan", "travel.book", "dining.plan"],
    },
    context: {
      read: [...DEMO_ROOT_CONTEXT],
      proposeWrites: [],
      ...restrictions(),
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
      prohibitedActions: prohibitedActions(),
    },
    maxDelegationDepth: 1,
    lifecycle: {
      validFrom: timeline.now,
      validUntil: timeline.validUntil,
    },
    approvedAt: timeline.now,
  };
}

export function createDemoChildRequests(
  signers: DemoSigners,
  timeline: DemoTimeline = DEFAULT_DEMO_TIMELINE,
): {
  flight: ChildPassRequest;
  stay: ChildPassRequest;
  dinner: ChildPassRequest;
} {
  const common = {
    taskId: DEMO_IDS.task,
    lifecycle: { validFrom: timeline.now, validUntil: timeline.childValidUntil },
    delegation: { allowed: false, maxDepth: 1 },
  } as const;

  return {
    flight: {
      delegate: identity(signers.flight, "FlightAgent"),
      audience: { allowedAgents: [], allowedServices: [DEMO_IDS.airline] },
      purpose: {
        taskId: common.taskId,
        statement: "Find and book Maya's flight to San Francisco.",
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
        ...restrictions(),
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
        prohibitedActions: prohibitedActions(),
      },
      delegation: common.delegation,
      lifecycle: common.lifecycle,
    },
    stay: {
      delegate: identity(signers.stay, "StayAgent"),
      audience: { allowedAgents: [], allowedServices: [DEMO_IDS.hotel] },
      purpose: {
        taskId: common.taskId,
        statement: "Find and book a stay near Maya's dinner.",
        scopes: ["travel.book"],
      },
      context: {
        read: ["travel.destination", "trip.event_area"],
        proposeWrites: [],
        ...restrictions(),
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
        prohibitedActions: prohibitedActions(),
      },
      delegation: common.delegation,
      lifecycle: common.lifecycle,
    },
    dinner: {
      delegate: identity(signers.dinner, "DinnerAgent"),
      audience: { allowedAgents: [], allowedServices: [DEMO_IDS.restaurant] },
      purpose: {
        taskId: common.taskId,
        statement: "Coordinate a safe dinner near Maya's event.",
        scopes: ["dining.plan"],
      },
      context: {
        read: ["calendar.required_arrival_time", "dietary.nut_free_required"],
        proposeWrites: [],
        ...restrictions(),
      },
      authority: {
        allowedActions: [],
        prohibitedActions: prohibitedActions(),
      },
      delegation: common.delegation,
      lifecycle: common.lifecycle,
    },
  };
}
