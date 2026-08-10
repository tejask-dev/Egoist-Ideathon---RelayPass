import { randomUUID } from "node:crypto";

import { z } from "zod";

import { canonicalJson, sha256Base64Url } from "./canonical";

const ReceiptEventSchema = z.enum([
  "pass_issued",
  "pass_derived",
  "context_read",
  "context_refused",
  "action_allowed",
  "action_refused",
  "step_up_required",
  "write_proposed",
  "pass_revoked",
]);

export const RelayReceiptSchema = z.object({
  receiptId: z.string().min(1).max(200),
  timestamp: z.string().datetime({ offset: true }),
  rootConsentId: z.string().min(1).max(200),
  passId: z.string().min(1).max(200),
  parentPassId: z.string().min(1).max(200).nullable(),
  agentId: z.string().min(1).max(200),
  verifierId: z.string().min(1).max(200),
  requestId: z.string().min(1).max(200),
  taskId: z.string().min(1).max(200),
  purposeScopes: z.array(z.string().min(1).max(200)).max(128),
  event: ReceiptEventSchema,
  decision: z.enum(["allowed", "refused", "pending_user"]),
  reason: z.string().min(1).max(500).optional(),
  requestedContext: z.array(z.string().max(200)).max(128),
  disclosedContext: z.array(z.string().max(200)).max(128),
  action: z
    .object({
      name: z.string().min(1).max(200),
      target: z.string().min(1).max(200),
      argumentsHash: z.string().min(16).max(128),
    })
    .optional(),
}).strict();

export type RelayReceipt = z.infer<typeof RelayReceiptSchema>;

export interface ReceiptRepository {
  append(receipt: RelayReceipt): Promise<void>;
  listByRoot(rootConsentId: string): Promise<RelayReceipt[]>;
}

function copyReceipt(receipt: RelayReceipt): RelayReceipt {
  return RelayReceiptSchema.parse(structuredClone(receipt));
}

export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly receipts: RelayReceipt[] = [];

  async append(receipt: RelayReceipt): Promise<void> {
    this.receipts.push(copyReceipt(receipt));
  }

  async listByRoot(rootConsentId: string): Promise<RelayReceipt[]> {
    return this.receipts
      .filter((receipt) => receipt.rootConsentId === rootConsentId)
      .map(copyReceipt);
  }
}

type ReceiptInput = Omit<RelayReceipt, "receiptId" | "timestamp" | "action"> & {
  timestamp?: string;
  action?: {
    name: string;
    target: string;
    arguments: Record<string, unknown>;
  };
};

export class ReceiptService {
  constructor(
    private readonly repository: ReceiptRepository,
    private readonly idFactory: () => string = () => `rr_${randomUUID()}`,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async record(input: ReceiptInput): Promise<RelayReceipt> {
    const receipt = RelayReceiptSchema.parse({
      ...input,
      receiptId: this.idFactory(),
      timestamp: input.timestamp ?? this.clock().toISOString(),
      action: input.action
        ? {
            name: input.action.name,
            target: input.action.target,
            argumentsHash: sha256Base64Url(canonicalJson(input.action.arguments)),
          }
        : undefined,
    });

    await this.repository.append(receipt);
    return receipt;
  }

  listByRoot(rootConsentId: string): Promise<RelayReceipt[]> {
    return this.repository.listByRoot(rootConsentId);
  }
}
