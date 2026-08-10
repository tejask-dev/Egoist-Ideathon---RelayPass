import { RelayPassError } from "./errors";
import type { EvaluationResult, PolicyEvaluator } from "./policy-evaluator";
import { ReceiptService, type RelayReceipt } from "./receipt-service";
import { RevocationService } from "./revocation-service";
import {
  ActionRequestSchema,
  VerifierDecisionSchema,
  type ActionRequest,
  type RelayPass,
  type VerifierRequest,
} from "./schemas";

export type ActionExecutionGrant = Readonly<{
  requestId: string;
  passId: string;
}>;

type StoredActionGrant = {
  chain: readonly RelayPass[];
  action: ActionRequest;
  expiresAt: number;
};

export interface ActionGrantIssuer {
  issue(
    chain: readonly RelayPass[],
    action: ActionRequest,
    requestId: string,
    expiresAt: Date,
  ): ActionExecutionGrant;
}

export interface ActionGrantConsumer {
  consume(grant: ActionExecutionGrant): Promise<{ pass: RelayPass; action: ActionRequest }>;
}

class ActionExecutionAuthority implements ActionGrantIssuer, ActionGrantConsumer {
  private readonly grants = new WeakMap<ActionExecutionGrant, StoredActionGrant>();

  constructor(
    private readonly revocations: RevocationService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  issue(
    chain: readonly RelayPass[],
    action: ActionRequest,
    requestId: string,
    expiresAt: Date,
  ): ActionExecutionGrant {
    const leaf = chain.at(-1);
    if (!leaf) throw new RelayPassError("invalid_input", "Cannot authorize an empty chain");

    const grant = Object.freeze({ requestId, passId: leaf.passId });
    this.grants.set(grant, {
      chain: [...chain],
      action: ActionRequestSchema.parse(action),
      expiresAt: expiresAt.getTime(),
    });
    return grant;
  }

  async consume(grant: ActionExecutionGrant): Promise<{ pass: RelayPass; action: ActionRequest }> {
    const stored = this.grants.get(grant);
    this.grants.delete(grant);
    const leaf = stored?.chain.at(-1);
    const now = this.clock();

    if (!stored || !leaf || leaf.passId !== grant.passId) {
      throw new RelayPassError("invalid_input", "Action grant is invalid or already consumed");
    }
    if (
      now.getTime() >= stored.expiresAt ||
      stored.chain.some(
        (pass) =>
          now.getTime() < Date.parse(pass.lifecycle.validFrom) ||
          now.getTime() >= Date.parse(pass.lifecycle.validUntil),
      )
    ) {
      throw new RelayPassError("invalid_input", "Action grant or pass chain is inactive");
    }

    let status;
    try {
      status = await this.revocations.checkChain(stored.chain);
    } catch {
      throw new RelayPassError(
        "invalid_input",
        "Live revocation status is unavailable; action failed closed",
      );
    }
    if (status.revoked) {
      throw new RelayPassError("invalid_input", "Pass was revoked before action execution");
    }

    return { pass: leaf, action: stored.action };
  }
}

export function createActionGrantAuthority(
  revocations: RevocationService,
  clock: () => Date = () => new Date(),
): { issuer: ActionGrantIssuer; consumer: ActionGrantConsumer } {
  const authority = new ActionExecutionAuthority(revocations, clock);
  return {
    issuer: Object.freeze({ issue: authority.issue.bind(authority) }),
    consumer: Object.freeze({ consume: authority.consume.bind(authority) }),
  };
}

export type ActionExecutionResult<T> = EvaluationResult & {
  execution?: T;
  receipt?: RelayReceipt;
};

/** Owns the final check, side effect, and success receipt as one server-side flow. */
export class ActionExecutionService {
  constructor(
    private readonly evaluator: PolicyEvaluator,
    private readonly authority: ActionGrantConsumer,
    private readonly receipts: ReceiptService,
  ) {}

  async authorizeAndExecute<T>(
    chain: readonly RelayPass[],
    request: VerifierRequest,
    execute: (action: ActionRequest) => Promise<T>,
  ): Promise<ActionExecutionResult<T>> {
    if (!request.action || request.requestedContext.length > 0) {
      throw new RelayPassError(
        "invalid_input",
        "ActionExecutionService accepts an action-only verifier request",
      );
    }

    const result = await this.evaluator.evaluate(chain, request);
    if (!result.decision.allowed) return result;
    if (!result.actionGrant) {
      throw new RelayPassError("invalid_input", "Allowed action did not produce an execution grant");
    }

    const { pass, action } = await this.authority.consume(result.actionGrant);
    const execution = await execute(action);
    const receipt = await this.receipts.record({
      rootConsentId: pass.rootConsentId,
      passId: pass.passId,
      parentPassId: pass.parentPassId,
      agentId: request.agentId,
      verifierId: request.serviceId,
      requestId: request.requestId,
      taskId: request.taskId,
      purposeScopes: request.purposeScopes,
      event: "action_allowed",
      decision: "allowed",
      requestedContext: [],
      disclosedContext: [],
      action: {
        name: action.name,
        target: action.target,
        arguments: action.arguments,
      },
    });

    return {
      ...result,
      decision: VerifierDecisionSchema.parse({
        ...result.decision,
        receiptId: receipt.receiptId,
      }),
      execution,
      receipt,
    };
  }
}
