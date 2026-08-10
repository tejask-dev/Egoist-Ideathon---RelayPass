import { canonicalJson } from "./canonical";
import type { ActionExecutionGrant, ActionGrantIssuer } from "./action-execution-service";
import { ChainVerifier } from "./chain-verifier";
import { RelayPassError } from "./errors";
import type { ContextGrantIssuer, ContextReleaseGrant } from "./passport-adapter";
import { verifyRequestSignature } from "./pass-signer";
import { ReceiptService, type RelayReceipt } from "./receipt-service";
import { RevocationService } from "./revocation-service";
import {
  VerifierDecisionSchema,
  VerifierRequestSchema,
  type ActionCapability,
  type DecisionCode,
  type RelayPass,
  type ValueConstraint,
  type VerifierDecision,
  type VerifierRequest,
} from "./schemas";

export type EvaluationResult = {
  decision: VerifierDecision;
  receipt?: RelayReceipt;
  contextGrant?: ContextReleaseGrant;
  actionGrant?: ActionExecutionGrant;
};

export interface RequestReplayGuard {
  consume(requestId: string, expiresAt: Date, now: Date): Promise<boolean>;
}

export class InMemoryRequestReplayGuard implements RequestReplayGuard {
  private readonly requests = new Map<string, number>();

  async consume(requestId: string, expiresAt: Date, now: Date): Promise<boolean> {
    for (const [id, expiry] of this.requests) {
      if (expiry <= now.getTime()) this.requests.delete(id);
    }
    if (this.requests.has(requestId)) return false;
    this.requests.set(requestId, expiresAt.getTime());
    return true;
  }
}

function scalarEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function satisfies(value: unknown, constraint: ValueConstraint): boolean {
  switch (constraint.kind) {
    case "exact":
      return scalarEqual(value, constraint.value);
    case "max":
      return typeof value === "number" && value <= constraint.value;
    case "min":
      return typeof value === "number" && value >= constraint.value;
    case "oneOf":
      return constraint.values.some((candidate) => scalarEqual(value, candidate));
    case "pattern":
      if (typeof value !== "string") return false;
      try {
        return new RegExp(constraint.value).test(value);
      } catch {
        return false;
      }
  }
}

function argumentsSatisfy(
  capability: ActionCapability,
  argumentsValue: Record<string, string | number | boolean>,
): boolean {
  const allowedKeys = new Set(Object.keys(capability.constraints));
  if (Object.keys(argumentsValue).some((key) => !allowedKeys.has(key))) {
    return false;
  }

  return Object.entries(capability.constraints).every(
    ([key, constraint]) => key in argumentsValue && satisfies(argumentsValue[key], constraint),
  );
}

function statusFor(code: DecisionCode): 200 | 400 | 401 | 403 {
  if (code === "allowed") return 200;
  if (code === "invalid_request") return 400;
  if (
    code === "invalid_chain" ||
    code === "invalid_signature" ||
    code === "untrusted_root" ||
    code === "relay_pass_not_yet_valid" ||
    code === "relay_pass_expired" ||
    code === "relay_pass_revoked" ||
    code === "revocation_status_unavailable" ||
    code === "request_replayed"
  ) {
    return 401;
  }
  return 403;
}

export class PolicyEvaluator {
  constructor(
    private readonly chainVerifier: ChainVerifier,
    private readonly revocations: RevocationService,
    private readonly receipts: ReceiptService,
    private readonly verifierId: string,
    private readonly releaseAuthority: ContextGrantIssuer,
    private readonly actionAuthority: ActionGrantIssuer,
    private readonly replayGuard: RequestReplayGuard = new InMemoryRequestReplayGuard(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async evaluate(
    chain: readonly RelayPass[],
    candidate: VerifierRequest,
  ): Promise<EvaluationResult> {
    const now = this.clock();
    const requestResult = VerifierRequestSchema.safeParse(candidate);
    if (!requestResult.success) {
      return {
        decision: this.decision(
          "invalid_request",
          [],
          requestResult.error.issues[0]?.message ?? "Request is malformed",
        ),
      };
    }
    const request = requestResult.data;
    const verification = await this.chainVerifier.verify(chain, {
      expectedServiceId: this.verifierId,
      now,
    });

    if (!verification.valid) {
      return { decision: this.decision(verification.code, [], verification.message) };
    }

    const pass = verification.leaf;
    // Authenticate the complete request before recording any request-attributed
    // refusal. Shape validation and caller-controlled identity fields are not
    // sufficient evidence that the leaf delegate made the request.
    try {
      await verifyRequestSignature(request, pass.delegate.publicKey);
    } catch (error) {
      const message = error instanceof RelayPassError ? error.message : "Request proof verification failed";
      return { decision: this.decision("invalid_signature", [], message) };
    }

    if (request.passId !== pass.passId) {
      return this.refuse(pass, request, "invalid_signature", "Request proof targets a different pass");
    }
    if (request.serviceId !== this.verifierId) {
      return this.refuse(pass, request, "wrong_audience", "Request targets a different verifier");
    }
    if (request.agentId !== pass.delegate.agentId) {
      return this.refuse(pass, request, "wrong_delegate", "Request presenter is not the pass delegate");
    }
    if (request.proof.kid !== pass.delegate.keyId) {
      return this.refuse(pass, request, "invalid_signature", "Request proof uses the wrong delegate key");
    }

    const issuedAt = Date.parse(request.issuedAt);
    const expiresAt = Date.parse(request.expiresAt);
    if (
      now.getTime() < issuedAt ||
      now.getTime() >= expiresAt ||
      expiresAt - issuedAt > 5 * 60 * 1000
    ) {
      return this.refuse(
        pass,
        request,
        "invalid_request",
        "Request proof is inactive, expired, or longer than five minutes",
      );
    }
    if (
      request.taskId !== pass.purpose.taskId ||
      request.purposeScopes.some((scope) => !pass.purpose.scopes.includes(scope))
    ) {
      return this.refuse(pass, request, "wrong_purpose", "Request purpose exceeds this pass");
    }
    if (!(await this.replayGuard.consume(request.requestId, new Date(expiresAt), now))) {
      return this.refuse(pass, request, "request_replayed", "Request ID was already consumed");
    }

    let revocation;
    try {
      revocation = await this.revocations.checkChain(verification.chain);
    } catch {
      return this.refuse(
        pass,
        request,
        "revocation_status_unavailable",
        "Live revocation status is unavailable; request failed closed",
      );
    }
    if (revocation.revoked) {
      return this.refuse(
        verification.leaf,
        request,
        "relay_pass_revoked",
        "The root or an ancestor branch has been revoked",
      );
    }

    const neverDisclose = request.requestedContext.filter((path) =>
      pass.context.neverDisclose.includes(path),
    );
    if (neverDisclose.length > 0) {
      return this.refuse(
        pass,
        request,
        "unauthorized_context",
        "Blocked before disclosure: requested context is never disclosable",
      );
    }

    const stepUp = request.requestedContext.filter((path) => pass.context.stepUpRequired.includes(path));
    if (stepUp.length > 0) {
      return this.refuse(
        pass,
        request,
        "step_up_required",
        `Additional human approval is required for: ${stepUp.join(", ")}`,
        "step_up_required",
        "pending_user",
      );
    }

    const unauthorizedContext = request.requestedContext.filter(
      (path) =>
        !pass.context.read.includes(path) ||
        pass.context.neverDisclose.includes(path) ||
        pass.context.stepUpRequired.includes(path),
    );
    if (unauthorizedContext.length > 0) {
      return this.refuse(
        pass,
        request,
        "unauthorized_context",
        "Blocked before disclosure: requested context is outside this pass",
      );
    }

    if (request.action) {
      const capability = pass.authority.allowedActions.find(
        (item) => item.action === request.action?.name && item.targets.includes(request.action.target),
      );
      if (
        !capability ||
        pass.authority.prohibitedActions.includes(request.action.name) ||
        capability.requiresHumanApproval
      ) {
        return this.refuse(
          pass,
          request,
          capability?.requiresHumanApproval ? "step_up_required" : "unauthorized_action",
          capability?.requiresHumanApproval
            ? "The action requires additional human approval"
            : "Action is outside this pass",
          capability?.requiresHumanApproval ? "step_up_required" : "action_refused",
          capability?.requiresHumanApproval ? "pending_user" : "refused",
        );
      }
      if (!argumentsSatisfy(capability, request.action.arguments)) {
        return this.refuse(
          pass,
          request,
          "constraint_violation",
          "Action arguments exceed the pass constraints",
          "action_refused",
        );
      }
    }

    const contextGrant =
      request.requestedContext.length > 0
        ? this.releaseAuthority.issue(
            verification.chain,
            request.requestedContext,
            request.requestId,
            new Date(
              Math.min(
                expiresAt,
                now.getTime() + 10_000,
                ...verification.chain.map((item) => Date.parse(item.lifecycle.validUntil)),
              ),
            ),
          )
        : undefined;
    const grantExpiry = new Date(
      Math.min(
        expiresAt,
        now.getTime() + 10_000,
        ...verification.chain.map((item) => Date.parse(item.lifecycle.validUntil)),
      ),
    );
    const actionGrant = request.action
      ? this.actionAuthority.issue(
          verification.chain,
          request.action,
          request.requestId,
          grantExpiry,
        )
      : undefined;

    return {
      decision: this.decision(
        "allowed",
        [],
        "Derived authority verified",
      ),
      contextGrant,
      actionGrant,
    };
  }

  private async refuse(
    pass: RelayPass | undefined,
    request: VerifierRequest,
    code: DecisionCode,
    message: string,
    explicitEvent?: "context_refused" | "action_refused" | "step_up_required",
    receiptDecision: "refused" | "pending_user" = "refused",
  ): Promise<EvaluationResult> {
    if (!pass) {
      return { decision: this.decision(code, [], message) };
    }

    const event =
      explicitEvent ?? (request.action ? "action_refused" : "context_refused");
    const receipt = await this.receipts.record({
      rootConsentId: pass.rootConsentId,
      passId: pass.passId,
      parentPassId: pass.parentPassId,
      // These two attribution fields come from verified server context rather
      // than duplicated request claims. Attempt details below are safe to use
      // because refuse() is reached only after the request proof verifies.
      agentId: pass.delegate.agentId,
      verifierId: this.verifierId,
      requestId: request.requestId,
      taskId: request.taskId,
      purposeScopes: request.purposeScopes,
      event,
      decision: receiptDecision,
      reason: code,
      requestedContext: request.requestedContext,
      disclosedContext: [],
      action: request.action
        ? {
            name: request.action.name,
            target: request.action.target,
            arguments: request.action.arguments,
          }
        : undefined,
    });

    return {
      decision: this.decision(code, [], message, receipt.receiptId),
      receipt,
    };
  }

  private decision(
    code: DecisionCode,
    disclosedContext: string[],
    message: string,
    receiptId?: string,
  ): VerifierDecision {
    return VerifierDecisionSchema.parse({
      allowed: code === "allowed",
      code,
      semanticStatus: statusFor(code),
      disclosedContext,
      message,
      receiptId,
    });
  }
}
