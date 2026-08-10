"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DemoAction,
  DemoDecision,
  DemoPassStatus,
  DemoReceiptView,
  DemoRelayNode,
  DemoSnapshot,
  DemoTechnicalProof,
  DemoVerifierCheck,
} from "@/lib/demo/types";

type IconName =
  | "arrow"
  | "bed"
  | "check"
  | "chevron"
  | "clock"
  | "fork"
  | "key"
  | "lock"
  | "passport"
  | "plane"
  | "receipt"
  | "refresh"
  | "shield"
  | "spark"
  | "user"
  | "x";

type PartnerTab = "airline" | "hotel" | "restaurant";

type PresentationCue = {
  label: string;
  detail: string;
  target: "passport" | "consent" | "relay" | "verifiers" | "receipts" | "revoke";
  tab?: PartnerTab;
  action?: DemoAction;
};

type DemoApiError = {
  error?: {
    code: string;
    message: string;
  };
};

const GUIDE = [
  {
    time: "0–10s",
    label: "Passport",
    cue: "Maya’s AI can know almost everything. That’s useful—until it delegates.",
    target: "passport",
  },
  {
    time: "10–25s",
    label: "Permission",
    cue: "Nova asks for a task-specific ceiling, then Maya approves it.",
    target: "consent",
  },
  {
    time: "25–40s",
    label: "Relay",
    cue: "Each specialist receives a visibly smaller permission.",
    target: "relay",
  },
  {
    time: "40–68s",
    label: "Verify + context",
    cue: "The airline verifies the pass; the address never crosses the boundary.",
    target: "verifiers",
  },
  {
    time: "68–88s",
    label: "Limit + minimum",
    cue: "The hotel limit holds; DinnerAgent receives the constraint, not the diagnosis.",
    target: "verifiers",
  },
  {
    time: "88–96s",
    label: "Receipts",
    cue: "The causal tree explains what happened because Maya gave permission.",
    target: "receipts",
  },
  {
    time: "96–105s",
    label: "Revoke",
    cue: "One root revocation stops every descendant on the next live check.",
    target: "revoke",
  },
] as const;

const PARTNER_TABS: PartnerTab[] = ["airline", "hotel", "restaurant"];

const NODE_ICONS: Record<DemoRelayNode["id"], IconName> = {
  maya: "passport",
  nova: "spark",
  flight: "plane",
  stay: "bed",
  dinner: "fork",
};

const EVENT_LABELS: Record<DemoReceiptView["event"], string> = {
  pass_issued: "Root pass issued",
  pass_derived: "Child pass derived",
  context_read: "Minimum context shared",
  context_refused: "Context stopped",
  action_allowed: "Action authorized",
  action_refused: "Action refused",
  step_up_required: "Human approval required",
  write_proposed: "Write proposed",
  pass_revoked: "Pass revoked",
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14M14 7l5 5-5 5" />
        </svg>
      );
    case "bed":
      return (
        <svg {...common}>
          <path d="M3 19v-8M21 19v-6a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v3M3 16h18M7 11V8a2 2 0 0 0-2-2H3v5" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "fork":
      return (
        <svg {...common}>
          <path d="M7 3v7M4 3v4a3 3 0 0 0 6 0V3M7 10v11M16 3v18M16 3c3 2 4 5 4 8h-4" />
        </svg>
      );
    case "key":
      return (
        <svg {...common}>
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 8-8M15 8l2 2M17 6l2 2" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "passport":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <circle cx="12" cy="11" r="3.5" />
          <path d="M8.5 11h7M12 7.5c1.2 1 1.2 6 0 7M9 17h6" />
        </svg>
      );
    case "plane":
      return (
        <svg {...common}>
          <path d="m22 2-8.5 19-3.2-7.3L3 10.5 22 2Z" />
          <path d="M10.3 13.7 15 9" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...common}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.1 9A7 7 0 0 1 18.4 6.5L20 12M4 12l1.6 5.5A7 7 0 0 0 17.9 15" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.5c0 4.7 3.2 8 7.5 9.5 4.3-1.5 7.5-4.8 7.5-9.5V6L12 3Z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="m12 3 1.3 4.2L17.5 9l-4.2 1.8L12 15l-1.3-4.2L6.5 9l4.2-1.8L12 3ZM18.5 15l.7 2.2 2.3.8-2.3.8-.7 2.2-.7-2.2-2.3-.8 2.3-.8.7-2.2Z" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
  }
}

function scrollTo(target: string) {
  document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function displayStatus(status: DemoPassStatus) {
  switch (status) {
    case "active":
      return "Active";
    case "revoked":
      return "Revoked";
    case "invalid":
      return "Invalid";
    case "not_issued":
      return "Not issued";
  }
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatExpiry(value: string | null) {
  if (!value) return "Not issued";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

function humanizeReceiptReason(reason?: string) {
  if (!reason) return undefined;
  const messages: Record<string, string> = {
    holder_approved_two_hour_root: "Maya approved this task-scoped root for two hours.",
    child_scope_verified_no_broader_than_parent: "Child scope verified as no broader than its parent.",
    unauthorized_context: "The requested context was never delegated to this agent.",
    constraint_violation: "The requested amount exceeded the signed maximum.",
    holder_revoked_root_and_descendants: "Maya revoked the root and every derived branch.",
    relay_pass_revoked: "A fresh live check found the root consent revoked.",
  };
  return messages[reason] ?? reason.replaceAll("_", " ");
}

function receiptCategory(receipt: DemoReceiptView) {
  if (receipt.event === "pass_issued") return "Permission";
  if (receipt.event === "pass_derived") return "Delegation";
  if (receipt.event === "pass_revoked") return "Revocation";
  if (receipt.decision === "refused") return "Refusal";
  if (receipt.event === "context_read") return "Disclosure";
  return "Action";
}

function receiptSummary(receipt: DemoReceiptView, snapshot: DemoSnapshot) {
  if (receipt.reason === "relay_pass_revoked") {
    return "The still-signed FlightAgent pass failed a fresh live status check.";
  }

  switch (receipt.event) {
    case "pass_issued":
      return "Maya approved Nova for this trip for two hours.";
    case "pass_derived": {
      const node = snapshot.relayTree.nodes.find((candidate) => candidate.name === receipt.agentName);
      return `${receipt.agentName} received ${node?.visibleCount ?? "fewer"} scoped ${node?.visibleCount === 2 ? "context pieces" : "permissions"}.`;
    }
    case "action_allowed": {
      const booking = snapshot.outcomes.flight?.booking;
      return booking
        ? `Flight booked — $${booking.amount} ≤ $650.`
        : "The requested action stayed within the signed maximum.";
    }
    case "context_refused":
      return receipt.requestedContext.includes("profile.home_address")
        ? "Home address blocked before disclosure · 0 fields shared."
        : "No context crossed the boundary after the live refusal.";
    case "action_refused":
      return snapshot.outcomes.hotel
        ? `$${snapshot.outcomes.hotel.requestedAmount} hotel refused · $${snapshot.outcomes.hotel.authorizedMaximum} maximum.`
        : "The action exceeded its inherited limit and no purchase occurred.";
    case "context_read":
      return "Dinner time + nut-free requirement shared · diagnosis excluded.";
    case "pass_revoked":
      return snapshot.relayTree.nodes.some((node) => node.id === "flight" && node.status !== "not_issued")
        ? "Maya revoked Nova · every issued descendant became invalid."
        : "Maya revoked Nova · no child pass had been issued.";
    default:
      return humanizeReceiptReason(receipt.reason) ?? `${receipt.verifierName} recorded the decision.`;
  }
}

function relayScopeChips(node: DemoRelayNode) {
  switch (node.id) {
    case "maya":
      return ["Human-owned", "Private by default"];
    case "nova":
      return ["Origin", "Destination", "Time", "Seat", "Trip budget $900", "Nut-free", "Event area"];
    case "flight":
      return ["Origin", "Destination", "Arrival", "Seat", "Book ≤ $650"];
    case "stay":
      return ["Destination", "Event area", "Book ≤ $220"];
    case "dinner":
      return ["Dinner time", "Nut-free"];
  }
}

function DecisionBadge({ decision }: { decision: DemoDecision }) {
  return (
    <span className={`decision-badge ${decision.allowed ? "is-allowed" : "is-refused"}`}>
      <span className="decision-dot" />
      {decision.semanticStatus} · {decision.code}
    </span>
  );
}

function TechnicalProof({ proof }: { proof: DemoTechnicalProof }) {
  return (
    <details className="technical-proof">
      <summary>
        <span>
          <Icon name="key" size={16} />
          View technical proof
        </span>
        <Icon name="chevron" size={16} />
      </summary>
      <div className="technical-proof-grid">
        <div>
          <span>Pass ID</span>
          <code>{proof.passId}</code>
        </div>
        <div>
          <span>Parent pass</span>
          <code>{proof.parentPassId ?? "Root"}</code>
        </div>
        <div>
          <span>Root consent</span>
          <code>{proof.rootConsentId}</code>
        </div>
        <div>
          <span>Delegate</span>
          <strong>{proof.delegate}</strong>
        </div>
        <div>
          <span>Audience</span>
          <strong>{proof.audience.join(", ")}</strong>
        </div>
        <div>
          <span>Purpose scopes</span>
          <strong>{proof.purposeScopes.join(" · ")}</strong>
        </div>
        <div>
          <span>Expires · demo clock</span>
          <strong>{formatExpiry(proof.expiresAt)} UTC</strong>
        </div>
        <div>
          <span>Parent hash</span>
          <code>{proof.parentHash ? `${proof.parentHash.slice(0, 18)}…` : "Root"}</code>
        </div>
        <div>
          <span>Signature</span>
          <strong className={proof.signatureVerified ? "proof-good" : "proof-bad"}>
            {proof.signatureVerified ? "Verified" : "Not verified"}
          </strong>
        </div>
        <div>
          <span>Parent chain</span>
          <strong className={proof.chainVerified ? "proof-good" : "proof-bad"}>
            {proof.chainVerified ? "Verified" : "Not verified"}
          </strong>
        </div>
        <div>
          <span>Live status</span>
          <strong className={proof.revocationStatus === "active" ? "proof-good" : "proof-bad"}>
            {proof.revocationStatus}
          </strong>
        </div>
      </div>
      <div className="proof-scope">
        <span>Context field names</span>
        <div>{proof.contextPaths.map((path) => <code key={path}>{path}</code>)}</div>
      </div>
      {proof.capabilities.length > 0 && (
        <div className="proof-capabilities">
          <span>Allowed action and inherited constraints</span>
          {proof.capabilities.map((capability) => (
            <div key={`${capability.action}-${capability.targets.join("-")}`}>
              <code>{capability.action}</code>
              <strong>{capability.targets.join(", ")}</strong>
              <small>{Object.entries(capability.constraints).map(([key, value]) => `${key} ${value}`).join(" · ")}</small>
            </div>
          ))}
        </div>
      )}
      <p className="proof-note">Sanitized proof only. The pass contains field names, not personal values; values are requested separately through PassportAdapter only after authorization.</p>
    </details>
  );
}

function VerifierChecks({ checks }: { checks: DemoVerifierCheck[] }) {
  return (
    <ol className="verifier-checks" aria-label="Verification checks">
      {checks.map((check, index) => (
        <li
          className={check.status === "passed" ? "check-passed" : "check-failed"}
          key={check.id}
          style={{ "--check-index": index } as React.CSSProperties}
        >
          <span className="check-icon"><Icon name={check.status === "passed" ? "check" : "x"} size={15} /></span>
          <span>
            <strong>{check.label}</strong>
            <small>{check.detail}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ReceiptEventButton({
  receipt,
  snapshot,
  selected,
  onSelect,
}: {
  receipt: DemoReceiptView;
  snapshot: DemoSnapshot;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`receipt-event is-${receipt.decision} ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="receipt-decision-icon"><Icon name={receipt.decision === "refused" ? "x" : "check"} size={13} /></span>
      <span className="receipt-event-copy">
        <span className="receipt-event-meta"><b>{receiptCategory(receipt)}</b><time>{formatTime(receipt.timestamp)} UTC</time></span>
        <strong>{EVENT_LABELS[receipt.event]}</strong>
        <small>{receiptSummary(receipt, snapshot)}</small>
      </span>
    </button>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <div className="loading-mark"><Icon name="shield" size={26} /></div>
      <p>Preparing Maya’s RelayPass demo…</p>
    </main>
  );
}

export function DemoExperience() {
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [loadingAction, setLoadingAction] = useState<DemoAction | "initialize" | null>("initialize");
  const [clientError, setClientError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<DemoRelayNode["id"]>("maya");
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [partnerTab, setPartnerTab] = useState<PartnerTab>("airline");
  const [guideOpen, setGuideOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [presentationReceiptsViewed, setPresentationReceiptsViewed] = useState(false);
  const [consentEditing, setConsentEditing] = useState(false);
  const [consentDenied, setConsentDenied] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const actionInFlight = useRef(false);
  const requestSequence = useRef(0);
  const revokeDialogRef = useRef<HTMLDivElement>(null);
  const guidePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const sequence = ++requestSequence.current;
      try {
        const response = await fetch("/api/demo", { cache: "no-store" });
        if (!response.ok) throw new Error(`Demo initialization failed (${response.status})`);
        const next = (await response.json()) as DemoSnapshot;
        if (active && sequence === requestSequence.current) {
          setSnapshot(next);
          setSelectedReceiptId(next.receipts.at(-1)?.receiptId ?? null);
          setClientError(null);
        }
      } catch (error) {
        if (active && sequence === requestSequence.current) {
          setClientError(error instanceof Error ? error.message : "Could not initialize the demo.");
        }
      } finally {
        if (active && sequence === requestSequence.current) setLoadingAction(null);
      }
    }

    function restoreFromBackForwardCache(event: PageTransitionEvent) {
      if (event.persisted && !actionInFlight.current) {
        setLoadingAction("initialize");
        void initialize();
      }
    }

    void initialize();
    window.addEventListener("pageshow", restoreFromBackForwardCache);
    return () => {
      active = false;
      window.removeEventListener("pageshow", restoreFromBackForwardCache);
    };
  }, []);

  useEffect(() => {
    const container = revokeConfirmOpen ? revokeDialogRef.current : guideOpen ? guidePanelRef.current : null;
    if (!container) return;
    const activeContainer = container;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "summary",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusInitialControl = () => {
      const initial = activeContainer.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?? activeContainer.querySelector<HTMLElement>(focusableSelector)
        ?? activeContainer;
      initial.focus();
    };

    const animationFrame = window.requestAnimationFrame(focusInitialControl);

    function handleOverlayKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (revokeConfirmOpen) setRevokeConfirmOpen(false);
        else setGuideOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = [...activeContainer.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) {
        event.preventDefault();
        activeContainer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !activeContainer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleOverlayKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleOverlayKeyDown);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [guideOpen, revokeConfirmOpen]);

  const runAction = useCallback(async (action: DemoAction, target?: string) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    const sequence = ++requestSequence.current;
    setLoadingAction(action);
    setClientError(null);

    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as DemoSnapshot | DemoApiError;
      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error.message
            : `Demo action failed (${response.status})`,
        );
      }
      const next = payload as DemoSnapshot;
      if (sequence !== requestSequence.current) return;
      setSnapshot(next);
      setSelectedReceiptId(next.receipts.at(-1)?.receiptId ?? null);

      if (action === "reset") {
        setSelectedNodeId("maya");
        setPartnerTab("airline");
        setConsentEditing(false);
        setConsentDenied(false);
        setRevokeConfirmOpen(false);
        setGuideOpen(false);
        setPresentationReceiptsViewed(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        if (action === "approve") setSelectedNodeId("nova");
        if (action === "derive") setSelectedNodeId("flight");
        if (action === "over_budget_hotel") setPartnerTab("hotel");
        if (action === "dinner_disclosure") {
          setPartnerTab("restaurant");
          setPresentationReceiptsViewed(true);
        }
        if (target) window.setTimeout(() => scrollTo(target), 140);
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        setClientError(error instanceof Error ? error.message : "The demo action could not complete.");
      }
    } finally {
      actionInFlight.current = false;
      if (sequence === requestSequence.current) setLoadingAction(null);
    }
  }, []);

  const memoryGroups = useMemo(() => {
    if (!snapshot) return [];
    const groups = new Map<string, typeof snapshot.passport.memories>();
    for (const memory of snapshot.passport.memories) {
      groups.set(memory.category, [...(groups.get(memory.category) ?? []), memory]);
    }
    return [...groups.entries()].map(([name, memories]) => ({ name, memories }));
  }, [snapshot]);

  const selectedNode = useMemo(
    () => snapshot?.relayTree.nodes.find((node) => node.id === selectedNodeId) ?? snapshot?.relayTree.nodes[0],
    [selectedNodeId, snapshot],
  );

  const selectedReceipt = useMemo(
    () => snapshot?.receipts.find((receipt) => receipt.receiptId === selectedReceiptId) ?? null,
    [selectedReceiptId, snapshot],
  );
  const selectedRefusedFields = useMemo(
    () => selectedReceipt?.requestedContext.filter((path) => !selectedReceipt.disclosedContext.includes(path)) ?? [],
    [selectedReceipt],
  );
  const selectedReceiptProof = useMemo(
    () => snapshot?.relayTree.nodes.find((node) => node.technicalProof?.passId === selectedReceipt?.passId)?.technicalProof,
    [selectedReceipt, snapshot],
  );

  if (!snapshot) {
    if (clientError) {
      return (
        <main className="loading-screen">
          <div className="loading-mark is-error"><Icon name="x" size={26} /></div>
          <h1>RelayPass could not start.</h1>
          <p>{clientError}</p>
          <button className="button button-primary" onClick={() => window.location.reload()}>Try again</button>
        </main>
      );
    }
    return <LoadingScreen />;
  }

  const isBusy = loadingAction !== null;
  const branchesIssued = snapshot.relayTree.nodes.some(
    (node) => node.id === "flight" && node.status !== "not_issued",
  );
  const featuredMemories = [
    "travel.origin_city",
    "travel.destination",
    "travel.preferred_airport",
    "calendar.dinner_time",
    "commerce.trip_budget",
    "dietary.nut_free_required",
  ].map((path) => snapshot.passport.memories.find((memory) => memory.path === path)).filter(
    (memory): memory is DemoSnapshot["passport"]["memories"][number] => Boolean(memory?.displayValue),
  );
  const rootReceipt = snapshot.receipts.find((receipt) => receipt.event === "pass_issued") ?? null;
  const revocationReceipts = snapshot.receipts.filter((receipt) => receipt.event === "pass_revoked");
  const receiptGroups = ["FlightAgent", "StayAgent", "DinnerAgent"]
    .map((agentName) => ({
      agentName,
      receipts: snapshot.receipts.filter(
        (receipt) => receipt.agentName === agentName && receipt.event !== "pass_revoked",
      ),
    }));
  const currentJourneyIndex = Math.max(
    0,
    snapshot.journey.findIndex((step) => step.state === "current") === -1
      ? snapshot.journey.length - 1
      : snapshot.journey.findIndex((step) => step.state === "current"),
  );
  const journeyProgress = snapshot.journey.length > 1
    ? (currentJourneyIndex / (snapshot.journey.length - 1)) * 100
    : 0;

  const baseCue: PresentationCue = (() => {
    if (!snapshot.consent.requested) {
      return { label: "Ask Nova to handle the trip", detail: "Begin with Maya’s permission.", target: "passport" };
    }
    if (!snapshot.consent.approved) {
      return { label: "Review Nova’s permission", detail: "See exactly what Maya is giving Nova.", target: "consent" };
    }
    if (snapshot.revocation.rootRevoked) {
      if (!branchesIssued) {
        return { label: "Reset the revoked demo", detail: "No FlightAgent pass exists to retry.", target: "revoke", action: "reset" };
      }
      return snapshot.outcomes.revokedRetry
        ? { label: "Demo complete", detail: "The signed pass exists; its authority does not.", target: "revoke" }
        : { label: "Retry the signed FlightAgent pass", detail: "A fresh live check must refuse it.", target: "revoke" };
    }
    if (!branchesIssued) {
      return { label: "Delegate the trip", detail: "Create three narrower specialist passes.", target: "consent" };
    }
    if (!snapshot.outcomes.flight) {
      return { label: "Verify FlightAgent", detail: "Let the airline independently check the pass.", target: "verifiers", tab: "airline" };
    }
    if (!snapshot.outcomes.homeAddress) {
      return { label: "Test the context boundary", detail: "Ask for Maya’s home address.", target: "verifiers", tab: "airline" };
    }
    if (!snapshot.outcomes.hotel) {
      return { label: "Test StayAgent’s $220 limit", detail: "Attempt the $260 hotel booking.", target: "verifiers", tab: "hotel" };
    }
    if (!snapshot.outcomes.dinner) {
      return { label: "Share DinnerAgent’s minimum", detail: "Send the constraint, not the diagnosis.", target: "verifiers", tab: "restaurant" };
    }
    return presentationReceiptsViewed
      ? { label: "Revoke Nova downstream", detail: "Take permission back once, everywhere.", target: "revoke" }
      : { label: "Inspect causal receipts", detail: "See what happened because Maya approved Nova.", target: "receipts" };
  })();

  function activateCue(cue: PresentationCue) {
    if (cue.action) {
      void runAction(cue.action);
      return;
    }
    if (cue.tab) setPartnerTab(cue.tab);
    if (cue.target === "receipts") setPresentationReceiptsViewed(true);
    window.setTimeout(() => scrollTo(cue.target), cue.tab ? 60 : 0);
  }

  function openJourneyStep(stepId: DemoSnapshot["journey"][number]["id"]) {
    if (stepId === "permission") return scrollTo("consent");
    if (stepId === "delegate") return scrollTo("relay");
    if (stepId === "verify") return activateCue({ label: "Verify", detail: "", target: "verifiers", tab: "airline" });
    if (stepId === "refuse") {
      return activateCue({ label: "Refuse", detail: "", target: "verifiers", tab: snapshot!.outcomes.homeAddress ? "hotel" : "airline" });
    }
    if (stepId === "receipts" && !snapshot!.outcomes.dinner) {
      return activateCue({ label: "Minimum", detail: "", target: "verifiers", tab: "restaurant" });
    }
    if (stepId === "receipts") {
      setPresentationReceiptsViewed(true);
      return scrollTo("receipts");
    }
    return scrollTo("revoke");
  }

  function handleVerifierTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentTab: PartnerTab) {
    const currentIndex = PARTNER_TABS.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % PARTNER_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + PARTNER_TABS.length) % PARTNER_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = PARTNER_TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = PARTNER_TABS[nextIndex];
    setPartnerTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`verifier-tab-${nextTab}`)?.focus());
  }

  return (
    <div className={`demo-shell ${presentationMode ? "is-presenting" : ""}`} id="top">
      <a className="skip-link" href="#main-content">Skip to demo</a>

      <header className="topbar">
        <a className="brand" href="#top" aria-label="RelayPass home">
          <span className="brand-mark"><Icon name="shield" size={17} /></span>
          <span>RelayPass</span>
        </a>
        <div className="topbar-actions">
          <span className="demo-mode"><span /> Deterministic demo</span>
          <button
            className={`quiet-button guide-trigger ${presentationMode ? "is-active" : ""}`}
            aria-pressed={presentationMode}
            onClick={() => {
              const next = !presentationMode;
              setPresentationMode(next);
              if (next) setGuideOpen(true);
            }}
          >
            <Icon name="spark" size={16} /> {presentationMode ? "Presentation on" : "Presentation mode"}
          </button>
          <button
            className="quiet-button reset-trigger"
            data-testid="reset-demo"
            disabled={isBusy}
            onClick={() => void runAction("reset")}
          >
            <Icon name="refresh" size={16} /> Reset demo
          </button>
        </div>
      </header>

      <nav className="journey-nav" aria-label="Demo journey">
        <div className="journey-track" aria-hidden="true"><span style={{ width: `${journeyProgress}%` }} /></div>
        {snapshot.journey.map((step, index) => {
          return (
            <button key={step.id} className={`journey-step is-${step.state}`} onClick={() => openJourneyStep(step.id)}>
              <span>{index + 1}</span>
              <small>{step.label}</small>
            </button>
          );
        })}
      </nav>

      {(clientError || snapshot.lastError) && (
        <div className="error-banner" role="alert">
          <Icon name="x" size={17} />
          <span>{clientError ?? snapshot.lastError?.message}</span>
          {clientError ? (
            <button onClick={() => setClientError(null)} aria-label="Dismiss error"><Icon name="x" size={15} /></button>
          ) : (
            <button onClick={() => void runAction("reset")} aria-label="Reset demo after error"><Icon name="refresh" size={15} /></button>
          )}
        </div>
      )}

      <main id="main-content">
        <section className="hero-section section-shell" id="passport" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span /> Consent is not transitive.</p>
            <h1 id="hero-title">Delegate the work.<br /><em>Not your entire life.</em></h1>
            <p className="hero-lede">
              RelayPass lets AI agents delegate work without delegating your entire life. Every handoff carries less context and less authority—never more.
            </p>
            <div className="hero-actions">
              <button
                className="button button-primary button-large"
                data-testid="ask-nova"
                disabled={isBusy}
                onClick={() => {
                  if (!snapshot.consent.requested) return void runAction("request_consent", "consent");
                  if (snapshot.outcomes.revokedRetry) return void runAction("reset");
                  activateCue(baseCue);
                }}
              >
                {loadingAction === "request_consent"
                  ? "Preparing request…"
                  : loadingAction === "reset"
                    ? "Resetting demo…"
                    : snapshot.outcomes.revokedRetry
                      ? "Reset for another run"
                      : baseCue.label}
                <Icon name="arrow" size={18} />
              </button>
              <button className="text-button" onClick={() => scrollTo("relay")}>See how context shrinks <Icon name="chevron" size={15} /></button>
            </div>
            <p className="prototype-note"><Icon name="shield" size={15} /> Prototype PassportAdapter · deterministic policy · no LLM authorization</p>
          </div>

          <div className="passport-visual" aria-label="Maya’s AI Passport with 42 memories">
            <div className="passport-shadow-card" aria-hidden="true" />
            <div className="passport-card">
              <div className="passport-card-topline">
                <div className="passport-owner">
                  <span className="avatar">M</span>
                  <span><small>Maya’s</small><strong>AI Passport</strong></span>
                </div>
                <span className="private-label"><Icon name="lock" size={13} /> Human-owned</span>
              </div>
              <div className="memory-count">
                <strong>{snapshot.passport.memoryCount}</strong>
                <span>memories<br />available to Maya’s AI</span>
              </div>
              <div className="passport-highlights" aria-label="Selected Passport memories">
                {featuredMemories.map((memory) => (
                  <span className={memory.delegatedToNova ? "is-approved" : "is-held"} key={memory.path}>
                    <small>{memory.label}</small>
                    <strong>{memory.displayValue}</strong>
                    <i>{memory.delegatedToNova ? "in request" : "stays here"}</i>
                  </span>
                ))}
              </div>
              <div className="memory-groups">
                {memoryGroups.map((group) => {
                  const restricted = group.memories.some((memory) => memory.sensitivity !== "standard");
                  return (
                    <div className={`memory-group ${restricted ? "is-private" : ""}`} key={group.name}>
                      <span className="memory-group-icon">{restricted ? <Icon name="lock" size={13} /> : <span />}</span>
                      <span><strong>{group.name}</strong><small>{group.memories.slice(0, 2).map((memory) => memory.label).join(" · ")}</small></span>
                      <b>{group.memories.length}</b>
                    </div>
                  );
                })}
              </div>
              <div className="passport-card-footer">
                <span>{snapshot.passport.sourceLabel}</span>
                <span className="passport-seal"><Icon name="passport" size={14} /> PRIVATE</span>
              </div>
            </div>
            <div className="passport-callout">
              <span className="callout-line" />
              <p><strong>Rich by design.</strong><br />Private by default.</p>
            </div>
          </div>
        </section>

        <section className="consent-section section-shell section-pad" id="consent" aria-labelledby="consent-title">
          <div className="section-intro narrow-intro">
            <p className="section-kicker">01 · Permission</p>
            <h2 id="consent-title">Nova asks. Maya decides.</h2>
            <p>A task-specific ceiling replaces blanket trust. Nothing exists until Maya approves.</p>
          </div>

          {!snapshot.consent.requested ? (
            <div className="locked-panel">
              <span className="locked-icon"><Icon name="lock" size={20} /></span>
              <div><strong>No permission exists</strong><p>Ask Nova to begin the consent flow.</p></div>
              <button className="button button-primary" onClick={() => void runAction("request_consent")} disabled={isBusy}>Ask Nova</button>
            </div>
          ) : consentDenied && !snapshot.consent.approved ? (
            <div className="consent-denied" role="status">
              <span><Icon name="shield" size={30} /></span>
              <h3>Request denied. Nova received nothing.</h3>
              <p>No pass was issued and no context crossed the boundary.</p>
              <button className="button button-secondary" onClick={() => setConsentDenied(false)}>Review request again</button>
            </div>
          ) : (
            <div className={`consent-sheet ${snapshot.consent.approved ? "is-approved" : ""}`}>
              <header className="consent-sheet-header">
                <div className="agent-lockup">
                  <span className="nova-avatar"><Icon name="spark" size={21} /></span>
                  <div><p>Nova wants context for one task</p><h3>Coordinate Maya’s San Francisco trip</h3></div>
                </div>
                <span className={`consent-status ${snapshot.consent.approved ? "approved" : "pending"}`}>
                  {snapshot.consent.approved ? <><Icon name="check" size={14} /> Signed & active</> : "Awaiting Maya"}
                </span>
              </header>

              <div className="consent-purpose">
                <span>Purpose</span>
                <blockquote>“{snapshot.consent.purpose}”</blockquote>
              </div>

              <div className="consent-columns">
                <div className="consent-column can-column">
                  <div className="column-heading"><span className="mini-icon positive"><Icon name="check" size={14} /></span><strong>Can see</strong></div>
                  <ul>{snapshot.consent.canSee.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className="consent-column do-column">
                  <div className="column-heading"><span className="mini-icon positive"><Icon name="arrow" size={14} /></span><strong>Can do</strong></div>
                  <ul>{snapshot.consent.canDo.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className="consent-column cannot-column">
                  <div className="column-heading"><span className="mini-icon negative"><Icon name="x" size={14} /></span><strong>Cannot</strong></div>
                  <ul>{snapshot.consent.cannot.slice(0, consentEditing ? undefined : 4).map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>

              <div className="consent-terms">
                <div><Icon name="clock" size={17} /><span><small>Expires</small><strong>{snapshot.consent.expires} after approval</strong></span></div>
                <div><Icon name="shield" size={17} /><span><small>Delegation</small><strong>{snapshot.consent.delegation}</strong></span></div>
              </div>

              {consentEditing && !snapshot.consent.approved && (
                <div className="edit-disclosure" role="region" aria-label="Exact approved fields">
                  <p><strong>Exact ceiling</strong><span>Seven human-readable pieces map to a fixed, typed policy for this presentation.</span></p>
                  <div>{snapshot.consent.canSee.map((item) => <span key={item}><Icon name="check" size={13} /> {item}</span>)}</div>
                  <small>For the deterministic 105-second flow, fields can be removed by denying and reissuing a new request; they can never be added by a child.</small>
                </div>
              )}

              <footer className="consent-actions">
                {snapshot.consent.approved ? (
                  <>
                    <p><Icon name="key" size={16} /> A real Ed25519-signed root RelayPass now exists.</p>
                    <button className="button button-primary" data-testid="delegate-trip" disabled={isBusy || branchesIssued} onClick={() => void runAction("derive", "relay")}>
                      {branchesIssued ? "Trip delegated" : loadingAction === "derive" ? "Deriving smaller passes…" : "Delegate the trip"}
                      {!branchesIssued && <Icon name="arrow" size={17} />}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="secondary-consent-actions">
                      <button className="text-button" onClick={() => setConsentEditing((value) => !value)}>{consentEditing ? "Close details" : "Review exact access"}</button>
                      <button className="text-button danger-text" onClick={() => setConsentDenied(true)}>Deny</button>
                    </div>
                    <button className="button button-primary" data-testid="approve-root" disabled={isBusy} onClick={() => void runAction("approve", "relay")}>
                      {loadingAction === "approve" ? "Signing permission…" : "Approve for 2 hours"}<Icon name="arrow" size={17} />
                    </button>
                  </>
                )}
              </footer>
            </div>
          )}
        </section>

        <section className="relay-section section-pad" id="relay" aria-labelledby="relay-title">
          <div className="section-shell">
            <div className="section-intro relay-intro">
              <p className="section-kicker">02 · Delegate</p>
              <h2 id="relay-title">One consent. Smaller at every handoff.</h2>
              <p>You authorized Nova—not every AI Nova might call.</p>
              <div className="equation" aria-label="42 becomes 7, then 5, 3, and 2">{snapshot.relayTree.visibleEquation}</div>
            </div>

            <div className={`relay-tree ${branchesIssued ? "is-grown" : "is-waiting"}`}>
              <svg className="tree-lines" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
                <path className="tree-line root-line" d="M500 130 L500 215" />
                <path className="tree-line branch-line" d="M500 325 L500 365 L170 365 L170 438" />
                <path className="tree-line branch-line" d="M500 325 L500 438" />
                <path className="tree-line branch-line" d="M500 365 L830 365 L830 438" />
                <path className="tree-line verifier-line" d="M170 555 L170 615" />
                <path className="tree-line verifier-line" d="M500 555 L500 615" />
                <path className="tree-line verifier-line" d="M830 555 L830 615" />
                <circle className="flow-pulse pulse-one" cx="500" cy="170" r="4" />
                <circle className="flow-pulse pulse-two" cx="335" cy="365" r="4" />
                <circle className="flow-pulse pulse-three" cx="665" cy="365" r="4" />
              </svg>

              <div className="consent-boundary-label">
                <span><Icon name="shield" size={12} /> Root consent boundary</span>
                <strong>7 approved · 35 stay with Maya · 2 hours</strong>
              </div>
              <span className="tree-annotation annotation-children">Attenuated by policy</span>

              {snapshot.relayTree.nodes.map((node) => (
                <button
                  key={node.id}
                  className={`tree-node node-${node.id} status-${node.status} ${selectedNodeId === node.id ? "is-selected" : ""}`}
                  onClick={() => setSelectedNodeId(node.id)}
                  aria-pressed={selectedNodeId === node.id}
                  data-testid={`relay-node-${node.id}`}
                >
                  <span className="node-topline">
                    <span className="node-icon"><Icon name={NODE_ICONS[node.id]} size={node.id === "maya" ? 20 : 17} /></span>
                    <span className="node-status"><i />{node.id === "maya" ? "Private" : displayStatus(node.status)}</span>
                  </span>
                  <span className="node-eyebrow">{node.eyebrow}</span>
                  <strong>{node.name}</strong>
                  <span className="node-count"><b>{node.visibleCount}</b> {node.countLabel.replace(/^\d+\s*/, "")}</span>
                  <span className="node-scope-chips" aria-label={`${node.name} scope`}>
                    {relayScopeChips(node).map((item) => <i key={item}>{item}</i>)}
                  </span>
                  {node.id !== "maya" && <span className="node-scope-bar" aria-hidden="true"><i /></span>}
                </button>
              ))}

              <button className="verifier-dock dock-airline" onClick={() => { setPartnerTab("airline"); scrollTo("verifiers"); }}>
                <span><Icon name="plane" size={15} /></span><small>Simulated verifier</small><strong>Northstar Air</strong>
              </button>
              <button className="verifier-dock dock-hotel" onClick={() => { setPartnerTab("hotel"); scrollTo("verifiers"); }}>
                <span><Icon name="bed" size={15} /></span><small>Simulated verifier</small><strong>Harbor House</strong>
              </button>
              <button className="verifier-dock dock-restaurant" onClick={() => { setPartnerTab("restaurant"); scrollTo("verifiers"); }}>
                <span><Icon name="fork" size={15} /></span><small>Simulated verifier</small><strong>Tableline</strong>
              </button>
            </div>

            {!branchesIssued && (
              <div className="tree-lock-overlay">
                <span><Icon name="lock" size={18} /></span>
                <p><strong>The tree is only a preview.</strong> Approve Nova, then derive three real child passes.</p>
                {snapshot.consent.approved && <button className="button button-primary" disabled={isBusy} onClick={() => void runAction("derive")}>Delegate the trip</button>}
              </div>
            )}

            {selectedNode && <NodeInspector node={selectedNode} />}
          </div>
        </section>

        <section className="verifier-section section-pad" id="verifiers" aria-labelledby="verifier-title">
          <div className="section-shell">
            <div className="section-intro split-intro">
              <div><p className="section-kicker">03 · Verify</p><h2 id="verifier-title">The service verifies what survived the handoff.</h2></div>
              <p>We have left Nova. These simulated partner services make fresh, deterministic checks before context or authority crosses their boundary.</p>
            </div>

            <div className="partner-surface">
              <header className="partner-chrome">
                <div className="partner-window-dots" aria-hidden="true"><i /><i /><i /></div>
                <p><span className="external-indicator" /> Independent simulated service</p>
                <span>relaypass proof required</span>
              </header>
              <nav className="partner-tabs" aria-label="Verifier services" role="tablist">
                <button id="verifier-tab-airline" role="tab" aria-selected={partnerTab === "airline"} aria-controls="verifier-panel-airline" tabIndex={partnerTab === "airline" ? 0 : -1} className={partnerTab === "airline" ? "active" : ""} onClick={() => setPartnerTab("airline")} onKeyDown={(event) => handleVerifierTabKeyDown(event, "airline")}><Icon name="plane" size={17} /><span><small>Airline verifier</small>Northstar Air</span></button>
                <button id="verifier-tab-hotel" role="tab" aria-selected={partnerTab === "hotel"} aria-controls="verifier-panel-hotel" tabIndex={partnerTab === "hotel" ? 0 : -1} className={partnerTab === "hotel" ? "active" : ""} onClick={() => setPartnerTab("hotel")} onKeyDown={(event) => handleVerifierTabKeyDown(event, "hotel")}><Icon name="bed" size={17} /><span><small>Hotel verifier</small>Harbor House</span></button>
                <button id="verifier-tab-restaurant" role="tab" aria-selected={partnerTab === "restaurant"} aria-controls="verifier-panel-restaurant" tabIndex={partnerTab === "restaurant" ? 0 : -1} className={partnerTab === "restaurant" ? "active" : ""} onClick={() => setPartnerTab("restaurant")} onKeyDown={(event) => handleVerifierTabKeyDown(event, "restaurant")}><Icon name="fork" size={17} /><span><small>Restaurant verifier</small>Tableline</span></button>
              </nav>

              {partnerTab === "airline" && (
                <AirlineVerifier snapshot={snapshot} busy={isBusy} loadingAction={loadingAction} runAction={runAction} />
              )}
              {partnerTab === "hotel" && (
                <HotelVerifier snapshot={snapshot} busy={isBusy} loadingAction={loadingAction} runAction={runAction} />
              )}
              {partnerTab === "restaurant" && (
                <RestaurantVerifier snapshot={snapshot} busy={isBusy} loadingAction={loadingAction} runAction={runAction} />
              )}
            </div>
          </div>
        </section>

        <section className="receipt-section section-pad" id="receipts" aria-labelledby="receipts-title">
          <div className="section-shell">
            <div className="section-intro split-intro">
              <div><p className="section-kicker">04 · Receipts</p><h2 id="receipts-title">Every handoff leaves a receipt.</h2></div>
              <p>Not logs. Causal provenance: what happened because Maya gave Nova permission?</p>
            </div>

            {snapshot.receipts.length === 0 ? (
              <div className="receipt-empty">
                <span><Icon name="receipt" size={22} /></span>
                <h3>The causal tree will grow here.</h3>
                <p>Issue a pass, verify an action, or trigger a refusal to create real receipts.</p>
              </div>
            ) : (
              <div className="receipt-layout">
                <div className="receipt-tree" aria-label="Causal receipt tree">
                  <div className="receipt-root">
                    <span className="avatar small">M</span>
                    <div><small>Human approval · 2 hours</small><strong>Maya approved Nova</strong></div>
                    <span>{snapshot.receipts.length} events</span>
                  </div>
                  <div className="receipt-consent-link"><span>7 approved pieces for one trip</span></div>

                  <div className="receipt-nova-node">
                    <div className="receipt-agent receipt-agent-nova">
                      <span><Icon name="spark" size={15} /></span>
                      <strong>Nova</strong>
                      <small>Root permission</small>
                    </div>
                    {rootReceipt && (
                      <ReceiptEventButton
                        receipt={rootReceipt}
                        snapshot={snapshot}
                        selected={selectedReceiptId === rootReceipt.receiptId}
                        onSelect={() => setSelectedReceiptId(rootReceipt.receiptId)}
                      />
                    )}
                  </div>

                  <div className="receipt-branch-label"><span>Nova delegated less—never more</span></div>
                  <div className="receipt-child-grid">
                    {receiptGroups.map((group) => (
                      <div className={`receipt-branch branch-${group.agentName.toLowerCase()}`} key={group.agentName}>
                        <div className="receipt-agent">
                          <span><Icon name={group.agentName === "FlightAgent" ? "plane" : group.agentName === "StayAgent" ? "bed" : "fork"} size={15} /></span>
                          <strong>{group.agentName}</strong>
                          <small>{group.agentName === "FlightAgent" ? "5 permissions" : group.agentName === "StayAgent" ? "3 permissions" : "2 contexts"}</small>
                        </div>
                        <div className="receipt-events">
                          {group.receipts.length === 0 ? <p>No events yet</p> : group.receipts.map((receipt) => (
                            <ReceiptEventButton
                              key={receipt.receiptId}
                              receipt={receipt}
                              snapshot={snapshot}
                              selected={selectedReceiptId === receipt.receiptId}
                              onSelect={() => setSelectedReceiptId(receipt.receiptId)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {revocationReceipts.map((receipt) => (
                    <button
                      className={`receipt-revocation-cascade ${selectedReceiptId === receipt.receiptId ? "is-selected" : ""}`}
                      key={receipt.receiptId}
                      onClick={() => setSelectedReceiptId(receipt.receiptId)}
                    >
                      <span><Icon name="x" size={15} /></span>
                      <div><small>Root revocation</small><strong>Maya revoked Nova</strong><p>{branchesIssued ? "FlightAgent, StayAgent, and DinnerAgent invalidated downstream." : "No child pass was ever issued."}</p></div>
                      <time>{formatTime(receipt.timestamp)} UTC</time>
                    </button>
                  ))}
                </div>

                <aside className={`receipt-inspector ${selectedReceipt ? "has-selection" : ""}`} aria-live="polite">
                  {selectedReceipt ? (
                    <>
                      <div className="receipt-inspector-heading">
                        <span className={`receipt-decision-icon is-${selectedReceipt.decision}`}><Icon name={selectedReceipt.decision === "refused" ? "x" : "check"} size={14} /></span>
                        <div><small>{receiptCategory(selectedReceipt)} receipt</small><h3>{EVENT_LABELS[selectedReceipt.event]}</h3></div>
                      </div>
                      <p className="receipt-human-summary">{receiptSummary(selectedReceipt, snapshot)}</p>
                      <div className="receipt-purpose">
                        <small>Task and purpose</small>
                        <p>{snapshot.consent.purpose}</p>
                        <div><code>{selectedReceipt.taskId}</code>{selectedReceipt.purposeScopes.map((scope) => <span key={scope}>{scope}</span>)}</div>
                      </div>
                      <div className="receipt-field-summary">
                        <span><small>Requested</small><strong>{selectedReceipt.requestedContext.length} fields</strong></span>
                        <span><small>Disclosed</small><strong>{selectedReceipt.disclosedContext.length} fields</strong></span>
                      </div>

                      {(selectedReceipt.requestedContext.length > 0 || selectedReceipt.disclosedContext.length > 0) && (
                        <div className="receipt-context-evidence">
                          {selectedReceipt.disclosedContext.length > 0 && (
                            <div><small>Disclosed field names</small><span>{selectedReceipt.disclosedContext.map((path) => <code key={path}>{path}</code>)}</span></div>
                          )}
                          {selectedRefusedFields.length > 0 && (
                            <div className="is-refused"><small>Refused field names</small><span>{selectedRefusedFields.map((path) => <code key={path}>{path}</code>)}</span></div>
                          )}
                        </div>
                      )}

                      <details className="receipt-technical-details">
                        <summary><span><Icon name="key" size={14} /> View safe technical evidence</span><Icon name="chevron" size={14} /></summary>
                        <dl>
                          <div><dt>Actor</dt><dd>{selectedReceipt.agentName}</dd></div>
                          <div><dt>Verifier</dt><dd>{selectedReceipt.verifierName}</dd></div>
                          <div><dt>Decision</dt><dd>{selectedReceipt.decision}</dd></div>
                          <div><dt>Time</dt><dd>{formatTime(selectedReceipt.timestamp)} UTC</dd></div>
                          <div><dt>Pass</dt><dd><code>{selectedReceipt.passId}</code></dd></div>
                          <div><dt>Parent pass</dt><dd><code>{selectedReceipt.parentPassId ?? "Root"}</code></dd></div>
                          <div><dt>Root consent</dt><dd><code>{selectedReceipt.rootConsentId}</code></dd></div>
                          <div><dt>Request</dt><dd><code>{selectedReceipt.requestId}</code></dd></div>
                          <div><dt>Task</dt><dd><code>{selectedReceipt.taskId}</code></dd></div>
                          <div><dt>Purpose scopes</dt><dd>{selectedReceipt.purposeScopes.join(" · ")}</dd></div>
                          <div><dt>Parent chain</dt><dd className={selectedReceiptProof?.chainVerified ? "proof-good" : undefined}>{selectedReceiptProof ? selectedReceiptProof.chainVerified ? "Verified" : "Not verified" : "Recorded by issuer"}</dd></div>
                          <div><dt>Live status</dt><dd>{selectedReceiptProof?.revocationStatus ?? "Receipt retained"}</dd></div>
                        </dl>
                        {selectedReceipt.action && (
                          <div className="receipt-action-evidence">
                            <span><small>Operation</small><code>{selectedReceipt.action.name}</code></span>
                            <span><small>Target</small><code>{selectedReceipt.action.target}</code></span>
                            <span><small>Arguments hash</small><code>{selectedReceipt.action.argumentsHash}</code></span>
                          </div>
                        )}
                        <p>{humanizeReceiptReason(selectedReceipt.reason)}</p>
                        <code className="receipt-id">{selectedReceipt.receiptId}</code>
                      </details>
                    </>
                  ) : (
                    <div className="receipt-inspector-empty"><Icon name="receipt" size={21} /><p>The newest real receipt will appear here automatically.</p></div>
                  )}
                </aside>
              </div>
            )}
          </div>
        </section>

        <section className="revoke-section section-pad" id="revoke" aria-labelledby="revoke-title">
          <div className="section-shell revoke-layout">
            <div className="revoke-copy">
              <p className="section-kicker">05 · Revoke</p>
              <h2 id="revoke-title">One decision ends the whole tree.</h2>
              <p>The signed pass still exists. Its authority does not. Every verifier checks live status again.</p>
              {!snapshot.revocation.rootRevoked ? (
                <button className="button button-danger button-large" data-testid="revoke-root" disabled={isBusy || !snapshot.consent.approved} onClick={() => setRevokeConfirmOpen(true)}>
                  <Icon name="lock" size={18} /> Revoke Nova + descendants
                </button>
              ) : (
                <div className="revoked-label"><Icon name="x" size={17} /><span><small>Root consent</small><strong>Revoked across every branch</strong></span></div>
              )}
            </div>

            <div className={`revocation-tree ${snapshot.revocation.rootRevoked ? "is-revoked" : ""}`}>
              {snapshot.relayTree.nodes.filter((node) => node.id !== "maya").map((node) => (
                <div className={`revocation-node status-${node.status}`} key={node.id}>
                  <span><Icon name={NODE_ICONS[node.id]} size={16} /></span>
                  <div><small>{node.parentId === "maya" ? "Root" : "Descendant"}</small><strong>{node.name}</strong></div>
                  <b>{snapshot.revocation.rootRevoked && node.status !== "not_issued" ? `Active → ${node.id === "nova" ? "Revoked" : "Invalid"}` : displayStatus(node.status)}</b>
                </div>
              ))}
              <div className="revocation-wave" aria-hidden="true" />
            </div>
          </div>

          {revokeConfirmOpen && !snapshot.revocation.rootRevoked && (
            <div className="revoke-confirm" role="alertdialog" aria-modal="true" aria-labelledby="revoke-confirm-title">
              <button className="modal-scrim" aria-label="Cancel revocation" onClick={() => setRevokeConfirmOpen(false)} />
              <div className="revoke-dialog" ref={revokeDialogRef} tabIndex={-1}>
                <span className="dialog-icon"><Icon name="lock" size={23} /></span>
                <p className="section-kicker">Immediate effect</p>
                <h3 id="revoke-confirm-title">Revoke Nova?</h3>
                <p>{branchesIssued ? "This immediately revokes Nova and invalidates FlightAgent, StayAgent, and DinnerAgent." : "This immediately revokes Nova. No child passes have been issued."} Existing receipts remain visible.</p>
                <div className="dialog-branches"><span>Nova</span><Icon name="arrow" size={15} /><span>{branchesIssued ? "All descendants" : "Future delegation blocked"}</span></div>
                <div className="dialog-actions">
                  <button className="button button-secondary" data-dialog-initial-focus onClick={() => setRevokeConfirmOpen(false)}>Cancel</button>
                  <button className="button button-danger" data-testid="confirm-revoke" disabled={isBusy} onClick={() => void runAction("revoke")}>
                    {loadingAction === "revoke" ? "Revoking live authority…" : "Confirm revocation"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {snapshot.revocation.rootRevoked && branchesIssued && (
            <div className="section-shell retry-panel">
              <div>
                <span className="retry-code">Same signed pass</span>
                <h3>Retry FlightAgent’s previously valid request.</h3>
                <p>The signed pass still exists. Its authority does not. A new live lookup must stop it now.</p>
              </div>
              <button className="button button-dark" data-testid="retry-revoked-flight" disabled={isBusy} onClick={() => void runAction("retry_revoked_flight")}>
                {loadingAction === "retry_revoked_flight" ? "Checking live status…" : "Retry same FlightAgent pass"}<Icon name="refresh" size={16} />
              </button>
              {snapshot.outcomes.revokedRetry && (
                <div className="retry-result" role="status">
                  <span className="http-status">{snapshot.outcomes.revokedRetry.decision.semanticStatus}</span>
                  <div><strong>{snapshot.outcomes.revokedRetry.decision.code}</strong><p>{snapshot.outcomes.revokedRetry.decision.message}</p></div>
                  <span className="zero-effect"><Icon name="check" size={14} /> 0 side effects</span>
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="closing-section">
          <div className="closing-mark"><Icon name="shield" size={26} /></div>
          <p>RelayPass lets AI agents delegate work<br />without delegating your entire life.</p>
          <h2>Your consent survives the handoff.</h2>
          <div className="closing-meta"><span>Technical prototype</span><span>Simulated travel services</span><span>Deterministic authorization</span></div>
        </footer>
      </main>

      {guideOpen && (
        <aside className="presenter-guide" role="dialog" aria-modal="true" aria-labelledby="presenter-guide-title">
          <button className="guide-scrim" aria-label="Close presenter guide" onClick={() => setGuideOpen(false)} />
          <div className="guide-panel" ref={guidePanelRef} tabIndex={-1}>
            <header><div><p className="section-kicker">Presentation mode</p><h2 id="presenter-guide-title">105-second run</h2></div><button data-dialog-initial-focus onClick={() => setGuideOpen(false)} aria-label="Close guide"><Icon name="x" size={18} /></button></header>
            <div className="guide-items">
              {GUIDE.map((item, index) => (
                <button key={item.time} onClick={() => {
                  if (item.label === "Verify + context") setPartnerTab("airline");
                  if (item.label === "Limit + minimum") setPartnerTab("hotel");
                  if (item.label === "Receipts") setPresentationReceiptsViewed(true);
                  setGuideOpen(false);
                  window.setTimeout(() => scrollTo(item.target), 100);
                }}>
                  <span className="guide-time">{item.time}</span>
                  <span className="guide-index">{index + 1}</span>
                  <span><strong>{item.label}</strong><small>{item.cue}</small></span>
                  <Icon name="chevron" size={16} />
                </button>
              ))}
            </div>
            <footer><span><i /> Session clock pinned</span><span>No external travel APIs</span></footer>
          </div>
        </aside>
      )}

      {presentationMode && !guideOpen && (
        <aside className="presentation-next" aria-live="polite">
          <span><small>Next demonstration</small><strong>{baseCue.label}</strong><p>{baseCue.detail}</p></span>
          {snapshot.outcomes.revokedRetry ? (
            <button className="button button-primary" disabled={isBusy} onClick={() => void runAction("reset")}>
              Reset demo <Icon name="refresh" size={15} />
            </button>
          ) : (
            <button className="button button-primary" disabled={isBusy} onClick={() => activateCue(baseCue)}>
              Show next <Icon name="arrow" size={15} />
            </button>
          )}
          <button className="presentation-close" aria-label="Exit presentation mode" onClick={() => setPresentationMode(false)}><Icon name="x" size={14} /></button>
        </aside>
      )}
    </div>
  );
}

function NodeInspector({ node }: { node: DemoRelayNode }) {
  return (
    <div className="node-inspector" aria-live="polite">
      <header>
        <span className="inspector-icon"><Icon name={NODE_ICONS[node.id]} size={19} /></span>
        <div><small>{node.eyebrow}</small><h3>{node.name}</h3></div>
        <span className={`inspector-status status-${node.status}`}><i />{node.id === "maya" ? "Private source" : displayStatus(node.status)}</span>
      </header>
      <div className="inspector-purpose"><span>Purpose</span><p>{node.purpose}</p></div>
      <div className="inspector-columns">
        <div>
          <h4><span className="mini-icon positive"><Icon name="check" size={13} /></span>Can see</h4>
          <ul>{node.canSee.length ? node.canSee.map((item) => <li key={item}>{item}</li>) : <li>Nothing until approval</li>}</ul>
        </div>
        <div>
          <h4><span className="mini-icon negative"><Icon name="x" size={13} /></span>Cannot see</h4>
          <ul>{node.cannotSee.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div>
          <h4><span className="mini-icon positive"><Icon name="arrow" size={13} /></span>Can do</h4>
          <ul>{node.canDo.length ? node.canDo.map((item) => <li key={item}>{item}</li>) : <li>No authority</li>}</ul>
        </div>
        <div>
          <h4><span className="mini-icon negative"><Icon name="x" size={13} /></span>Cannot do</h4>
          <ul>{node.cannotDo.length ? node.cannotDo.map((item) => <li key={item}>{item}</li>) : <li>No additional prohibitions</li>}</ul>
        </div>
      </div>
      <footer>
        <span><small>Parent</small><strong>{node.parentId ? node.parentId === "maya" ? "Maya" : node.parentId === "nova" ? "Nova" : node.parentId : "Human-owned"}</strong></span>
        <span><small>Limits</small><strong>{node.limits.join(" · ") || "Private source"}</strong></span>
        <span><small>Expires</small><strong>{formatExpiry(node.expiresAt)}{node.expiresAt ? " UTC" : ""}</strong></span>
        <span><small>Delegation</small><strong>{node.delegation}</strong></span>
      </footer>
      {node.technicalProof && <TechnicalProof proof={node.technicalProof} />}
    </div>
  );
}

type VerifierProps = {
  snapshot: DemoSnapshot;
  busy: boolean;
  loadingAction: DemoAction | "initialize" | null;
  runAction: (action: DemoAction, target?: string) => Promise<void>;
};

function AirlineVerifier({ snapshot, busy, loadingAction, runAction }: VerifierProps) {
  const flight = snapshot.outcomes.flight;
  const attack = snapshot.outcomes.homeAddress;
  const flightNode = snapshot.relayTree.nodes.find((node) => node.id === "flight");

  return (
    <div className="partner-body airline-body" id="verifier-panel-airline" role="tabpanel" aria-labelledby="verifier-tab-airline" tabIndex={0}>
      <div className="partner-brandline"><span className="partner-logo airline-logo"><Icon name="plane" size={19} /></span><div><small>Northstar Air · authorization desk</small><h3>FlightAgent is presenting a RelayPass</h3></div><span className="service-status"><i /> verifier online</span></div>
      {!flight ? (
        <div className="presentation-card">
          <div className="pass-envelope">
            <span className="pass-ribbon"><Icon name="shield" size={16} /> Prototype derived RelayPass</span>
            <div className="pass-route"><strong>YYZ</strong><span><i /><Icon name="plane" size={17} /><i /></span><strong>SFO</strong></div>
            <div className="pass-summary"><span><small>Delegate</small><strong>FlightAgent</strong></span><span><small>Maximum</small><strong>$650 USD</strong></span><span><small>Context</small><strong>4 fields</strong></span></div>
          </div>
          <div className="verify-prompt">
            <span className="prompt-icon"><Icon name="shield" size={22} /></span>
            <h4>Trust the proof, not the agent.</h4>
            <p>Northstar will verify the full parent chain, holder-bound request, exact task, price constraint, and live revocation state.</p>
            <button className="button button-partner" data-testid="verify-flight" disabled={busy || flightNode?.status !== "active"} onClick={() => void runAction("verify_flight")}>
              {loadingAction === "verify_flight" ? "Verifying signed chain…" : "Verify with Airline"}<Icon name="arrow" size={17} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="verification-result-grid">
            <div className="verification-summary">
              <p className="result-eyebrow"><span /> Live verification</p>
              <VerifierChecks checks={flight.checks} />
            </div>
            <div className="booking-result">
              <span className="authorized-icon"><Icon name="check" size={24} /></span>
              <small>Deterministic decision</small>
              <h4>{flight.decision.allowed ? "BOOKING AUTHORIZED" : "AUTHORIZATION FAILED"}</h4>
              <p>{flight.booking ? `${flight.booking.route} · ${flight.booking.currency} $${flight.booking.amount}` : flight.decision.message}</p>
              <DecisionBadge decision={flight.decision} />
              <span className="booking-evidence">{flight.sideEffectPerformed ? "Booking side effect performed once" : "No side effect performed"}</span>
            </div>
          </div>
          <TechnicalProof proof={flight.technicalProof} />
          {!attack && (
            <div className="attack-trigger">
              <div><span className="attack-label">Attack A</span><strong>A bad prompt asks for one more field.</strong><p>Does FlightAgent’s working credential let it fetch Maya’s home address?</p></div>
              <button className="button button-attack" data-testid="forbidden-context" disabled={busy || flightNode?.status !== "active"} onClick={() => void runAction("forbidden_context")}>
                {loadingAction === "forbidden_context" ? "Testing boundary…" : "Request Maya’s home address"}<Icon name="arrow" size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {attack && <ContextBoundary attack={attack} />}
    </div>
  );
}

function ContextBoundary({ attack }: { attack: NonNullable<DemoSnapshot["outcomes"]["homeAddress"]> }) {
  return (
    <div className="context-boundary" role="status">
      <div className="boundary-heading"><span><b className="attack-label">Attack A · Context</b><strong>FlightAgent asked for <code>profile.home_address</code></strong></span><DecisionBadge decision={attack.decision} /></div>
      <div className="boundary-stage">
        <div className="boundary-origin">
          <small>Maya’s AI Passport</small>
          <code>profile.home_address</code>
          <span className="blocked-chip"><Icon name="lock" size={14} /> Field exists here · value never fetched</span>
        </div>
        <div className="hard-boundary">
          <span><Icon name="shield" size={24} /></span>
          <i />
          <strong>RELAYPASS<br />BOUNDARY</strong>
        </div>
        <div className="boundary-outcome">
          <span className="zero-number">0</span>
          <small>fields received by FlightAgent</small>
          <strong>Nothing crossed</strong>
        </div>
      </div>
      <div className="boundary-copy">
        <div><span className="blocked-mark"><Icon name="x" size={22} /></span><h4>BLOCKED BEFORE DISCLOSURE</h4></div>
        <p>This field never entered FlightAgent’s permission. The policy refused it before the Passport value could be fetched.</p>
      </div>
      <div className="boundary-allowed">
        <small>FlightAgent was allowed</small>
        <span>{["Origin", "Destination", "Arrival deadline", "Seat preference", "Book flight ≤ $650"].map((item) => <i key={item}><Icon name="check" size={12} /> {item}</i>)}</span>
      </div>
      <div className="evidence-strip">
        <span><Icon name="check" size={14} /><strong>Shared</strong> nothing</span>
        <span><Icon name="check" size={14} /><strong>Passport fetch</strong> {attack.passportValueFetchCalled ? "called" : "not called"}</span>
        <span><Icon name="receipt" size={14} /><strong>Refusal receipt</strong> created</span>
      </div>
    </div>
  );
}

function HotelVerifier({ snapshot, busy, loadingAction, runAction }: VerifierProps) {
  const result = snapshot.outcomes.hotel;
  const stayNode = snapshot.relayTree.nodes.find((node) => node.id === "stay");
  return (
    <div className="partner-body hotel-body" id="verifier-panel-hotel" role="tabpanel" aria-labelledby="verifier-tab-hotel" tabIndex={0}>
      <div className="partner-brandline"><span className="partner-logo hotel-logo"><Icon name="bed" size={19} /></span><div><small>Harbor House · reservation desk</small><h3>StayAgent requests a $260 room</h3></div><span className="service-status"><i /> verifier online</span></div>
      {!result ? (
        <div className="hotel-request">
          <div className="hotel-amount-card">
            <span className="attack-label">Attack B · Authority</span>
            <p>Reservation total</p><strong>$260</strong><small>1 night · Mission District</small>
          </div>
          <div className="budget-rule">
            <div><span>Delegated maximum</span><strong>$220</strong></div>
            <div className="budget-track"><i style={{ width: "84.6%" }} /><b /></div>
            <div className="budget-labels"><span>$0</span><span>$220 cap</span><span>$260 asked</span></div>
          </div>
          <div className="verify-prompt compact">
            <h4>Can child authority expand?</h4>
            <p>The domain policy—not this progress bar—will decide before any purchase side effect.</p>
            <button className="button button-partner" data-testid="over-budget-hotel" disabled={busy || stayNode?.status !== "active"} onClick={() => void runAction("over_budget_hotel")}>
              {loadingAction === "over_budget_hotel" ? "Evaluating limit…" : "Attempt $260 hotel booking"}<Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="hotel-refusal" role="status">
          <div className="refusal-stamp"><Icon name="x" size={26} /><small>Deterministic decision</small><h4>ACTION REFUSED</h4><DecisionBadge decision={result.decision} /></div>
          <div className="amount-comparison"><span><small>Requested</small><strong>${result.requestedAmount}</strong></span><i /><span><small>Authorized maximum</small><strong>${result.authorizedMaximum}</strong></span></div>
          <div className="hotel-refusal-copy"><strong>A child can inherit less authority. Never more.</strong><p>{result.decision.message}</p></div>
          <div className="evidence-strip"><span><Icon name="check" size={14} /><strong>Purchase</strong> {result.purchaseMade ? "made" : "not made"}</span><span><Icon name="receipt" size={14} /><strong>Refusal receipt</strong> created</span></div>
        </div>
      )}
    </div>
  );
}

function RestaurantVerifier({ snapshot, busy, loadingAction, runAction }: VerifierProps) {
  const result = snapshot.outcomes.dinner;
  const dinnerNode = snapshot.relayTree.nodes.find((node) => node.id === "dinner");
  return (
    <div className="partner-body restaurant-body" id="verifier-panel-restaurant" role="tabpanel" aria-labelledby="verifier-tab-restaurant" tabIndex={0}>
      <div className="partner-brandline"><span className="partner-logo restaurant-logo"><Icon name="fork" size={19} /></span><div><small>Tableline · dining coordinator</small><h3>DinnerAgent asks for the minimum</h3></div><span className="service-status"><i /> verifier online</span></div>
      <div className="minimum-disclosure">
        <div className="needed-side">
          <span className="minimum-label">Needs to know</span>
          <div className="context-ticket"><span><Icon name="clock" size={17} /></span><div><small>Timing</small><strong>Dinner / arrival time</strong></div><b>{result ? "Shared" : "Permitted"}</b></div>
          <div className="context-ticket important"><span><Icon name="check" size={17} /></span><div><small>Functional constraint</small><strong>nut_free_required = true</strong></div><b>{result ? "Shared" : "Permitted"}</b></div>
        </div>
        <div className="minimum-divider"><span>Share the constraint</span><i /><span>not the diagnosis</span></div>
        <div className="private-side">
          <span className="minimum-label">Does not need</span>
          <div className="private-context"><Icon name="lock" size={16} /><span><small>Underlying reason</small><strong>Diagnosis</strong></span><b>Never in pass</b></div>
          <div className="private-context"><Icon name="lock" size={16} /><span><small>Private history</small><strong>Medical details</strong></span><b>Not requested</b></div>
          <div className="private-context"><Icon name="lock" size={16} /><span><small>Unrelated authority</small><strong>Payment</strong></span><b>No spend</b></div>
        </div>
      </div>
      {!result ? (
        <div className="dinner-action"><p>Release only the two approved context items through the real disclosure service.</p><button className="button button-partner" data-testid="dinner-disclosure" disabled={busy || dinnerNode?.status !== "active"} onClick={() => void runAction("dinner_disclosure", "receipts")}>
          {loadingAction === "dinner_disclosure" ? "Releasing minimum…" : "Share dinner minimum"}<Icon name="arrow" size={16} />
        </button></div>
      ) : (
        <div className="dinner-result" role="status"><span className="authorized-icon small"><Icon name="check" size={18} /></span><div><small>Minimum disclosure complete</small><strong>{Object.keys(result.disclosedContext).length} context items shared · diagnosis excluded</strong></div><DecisionBadge decision={result.decision} /></div>
      )}
    </div>
  );
}
