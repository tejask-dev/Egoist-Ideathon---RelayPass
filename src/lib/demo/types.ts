import type { DecisionCode } from "../relaypass/schemas";

export const DEMO_ACTIONS = [
  "request_consent",
  "approve",
  "derive",
  "verify_flight",
  "forbidden_context",
  "over_budget_hotel",
  "dinner_disclosure",
  "revoke",
  "retry_revoked_flight",
  "reset",
] as const;

export type DemoAction = (typeof DEMO_ACTIONS)[number];

export type DemoStage =
  | "passport"
  | "consent"
  | "root_active"
  | "children_active"
  | "activity_recorded"
  | "root_revoked"
  | "retry_refused";

export type DemoPassStatus = "not_issued" | "active" | "revoked" | "invalid";

export type DemoDecision = {
  allowed: boolean;
  code: DecisionCode;
  semanticStatus: 200 | 400 | 401 | 403;
  disclosedContext: string[];
  message: string;
  receiptId?: string;
};

export type DemoMemoryView = {
  path: string;
  label: string;
  category: string;
  sensitivity: "standard" | "sensitive" | "restricted";
  displayValue?: string;
  delegatedToNova: boolean;
};

export type DemoConsentView = {
  requested: boolean;
  approved: boolean;
  who: "Nova";
  purpose: string;
  canSee: string[];
  canDo: string[];
  cannot: string[];
  expires: "2 hours";
  delegation: string;
};

export type DemoTechnicalProof = {
  passId: string;
  parentPassId: string | null;
  rootConsentId: string;
  delegate: string;
  audience: string[];
  purposeScopes: string[];
  contextPaths: string[];
  capabilities: Array<{
    action: string;
    targets: string[];
    constraints: Record<string, string>;
  }>;
  issuedAt: string;
  expiresAt: string;
  parentHash: string | null;
  signatureVerified: boolean;
  chainVerified: boolean;
  revocationStatus: "active" | "revoked" | "invalid";
};

export type DemoRelayNode = {
  id: "maya" | "nova" | "flight" | "stay" | "dinner";
  name: string;
  eyebrow: string;
  parentId: DemoRelayNode["id"] | null;
  visibleCount: 42 | 7 | 5 | 3 | 2;
  countLabel: string;
  status: DemoPassStatus;
  purpose: string;
  canSee: string[];
  cannotSee: string[];
  canDo: string[];
  cannotDo: string[];
  limits: string[];
  expiresAt: string | null;
  delegation: string;
  technicalProof?: DemoTechnicalProof;
};

export type DemoVerifierCheck = {
  id: string;
  label: string;
  status: "passed" | "failed";
  detail: string;
};

export type DemoFlightResult = {
  decision: DemoDecision;
  checks: DemoVerifierCheck[];
  booking?: {
    bookingId: string;
    route: string;
    amount: number;
    currency: string;
  };
  sideEffectPerformed: boolean;
  technicalProof: DemoTechnicalProof;
};

export type DemoContextAttackResult = {
  requestedPath: "profile.home_address";
  decision: DemoDecision;
  sharedFields: 0;
  passportValueFetchCalled: false;
  receiptId: string;
};

export type DemoHotelAttackResult = {
  requestedAmount: 260;
  authorizedMaximum: 220;
  decision: DemoDecision;
  purchaseMade: false;
  receiptId: string;
};

export type DemoDinnerResult = {
  decision: DemoDecision;
  disclosedContext: Record<string, string | number | boolean>;
  requiredConstraint: true;
  diagnosisInPass: false;
  diagnosisDisclosed: false;
  receiptId: string;
};

export type DemoRevokedRetryResult = {
  decision: DemoDecision;
  checks: DemoVerifierCheck[];
  samePassId: true;
  sideEffectPerformed: false;
  technicalProof: DemoTechnicalProof;
};

export type DemoReceiptView = {
  receiptId: string;
  timestamp: string;
  rootConsentId: string;
  passId: string;
  parentPassId: string | null;
  agentId: string;
  agentName: string;
  verifierId: string;
  verifierName: string;
  requestId: string;
  taskId: string;
  purposeScopes: string[];
  event:
    | "pass_issued"
    | "pass_derived"
    | "context_read"
    | "context_refused"
    | "action_allowed"
    | "action_refused"
    | "step_up_required"
    | "write_proposed"
    | "pass_revoked";
  decision: "allowed" | "refused" | "pending_user";
  reason?: string;
  requestedContext: string[];
  disclosedContext: string[];
  action?: {
    name: string;
    target: string;
    argumentsHash: string;
  };
};

export type DemoJourneyStep = {
  id: "permission" | "delegate" | "verify" | "refuse" | "receipts" | "revoke";
  label: string;
  state: "complete" | "current" | "upcoming";
};

export type DemoSnapshot = {
  version: "relaypass-demo/1";
  stage: DemoStage;
  passport: {
    holder: "Maya";
    memoryCount: 42;
    sourceLabel: "Prototype PassportAdapter";
    memories: DemoMemoryView[];
  };
  consent: DemoConsentView;
  relayTree: {
    nodes: DemoRelayNode[];
    visibleEquation: "42 \u2192 7 \u2192 5 / 3 / 2";
  };
  outcomes: {
    flight?: DemoFlightResult;
    homeAddress?: DemoContextAttackResult;
    hotel?: DemoHotelAttackResult;
    dinner?: DemoDinnerResult;
    revokedRetry?: DemoRevokedRetryResult;
  };
  receipts: DemoReceiptView[];
  revocation: {
    rootRevoked: boolean;
    revokedAt?: string;
    message: string;
  };
  journey: DemoJourneyStep[];
  lastError?: {
    code: string;
    message: string;
  };
};
