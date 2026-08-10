import { RelayPassError } from "./errors";
import type { PassportAdapter } from "./passport-adapter";
import type { EvaluationResult, PolicyEvaluator } from "./policy-evaluator";
import { ReceiptService, type RelayReceipt } from "./receipt-service";
import {
  VerifierDecisionSchema,
  type RelayPass,
  type VerifierRequest,
} from "./schemas";

export type DisclosureResult = EvaluationResult & {
  context?: Record<string, string | number | boolean>;
  receipt?: RelayReceipt;
};

/**
 * Server-side composition boundary. Request handlers call this service rather
 * than passing decisions into PassportAdapter themselves.
 */
export class ContextDisclosureService {
  constructor(
    private readonly evaluator: PolicyEvaluator,
    private readonly passport: PassportAdapter,
    private readonly receipts: ReceiptService,
  ) {}

  async authorizeAndRelease(
    chain: readonly RelayPass[],
    request: VerifierRequest,
  ): Promise<DisclosureResult> {
    if (request.action) {
      throw new RelayPassError(
        "invalid_input",
        "ContextDisclosureService accepts a context-only verifier request",
      );
    }
    const result = await this.evaluator.evaluate(chain, request);
    if (!result.decision.allowed || request.requestedContext.length === 0) {
      return result;
    }

    if (!result.contextGrant) {
      throw new RelayPassError(
        "invalid_input",
        "Allowed disclosure did not produce an internal release grant",
      );
    }

    // The adapter consumes the grant once and re-checks live revocation here.
    const context = await this.passport.releaseAuthorizedContext(result.contextGrant);
    const leaf = chain.at(-1)!;
    const receipt = await this.receipts.record({
      rootConsentId: leaf.rootConsentId,
      passId: leaf.passId,
      parentPassId: leaf.parentPassId,
      agentId: request.agentId,
      verifierId: request.serviceId,
      requestId: request.requestId,
      taskId: request.taskId,
      purposeScopes: request.purposeScopes,
      event: "context_read",
      decision: "allowed",
      requestedContext: request.requestedContext,
      disclosedContext: request.requestedContext,
    });

    return {
      ...result,
      decision: VerifierDecisionSchema.parse({
        ...result.decision,
        disclosedContext: request.requestedContext,
        receiptId: receipt.receiptId,
      }),
      context,
      receipt,
    };
  }
}
