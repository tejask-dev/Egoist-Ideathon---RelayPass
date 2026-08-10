import { z } from "zod";

import type { RelayPass } from "./schemas";

export const RevocationRecordSchema = z.object({
  kind: z.enum(["root", "branch"]),
  rootConsentId: z.string().min(1),
  passId: z.string().min(1).optional(),
  revokedAt: z.string().datetime({ offset: true }),
  reason: z.string().min(1),
}).strict();

export type RevocationRecord = z.infer<typeof RevocationRecordSchema>;

export interface RevocationRepository {
  save(record: RevocationRecord): Promise<void>;
  findRoot(rootConsentId: string): Promise<RevocationRecord | undefined>;
  findBranch(rootConsentId: string, passId: string): Promise<RevocationRecord | undefined>;
}

export class InMemoryRevocationRepository implements RevocationRepository {
  private readonly roots = new Map<string, RevocationRecord>();
  private readonly branches = new Map<string, Map<string, RevocationRecord>>();

  async save(candidate: RevocationRecord): Promise<void> {
    const record = RevocationRecordSchema.parse(candidate);
    if (record.kind === "root") {
      this.roots.set(record.rootConsentId, record);
    } else if (record.passId) {
      const rootBranches = this.branches.get(record.rootConsentId) ?? new Map<string, RevocationRecord>();
      rootBranches.set(record.passId, record);
      this.branches.set(record.rootConsentId, rootBranches);
    }
  }

  async findRoot(rootConsentId: string): Promise<RevocationRecord | undefined> {
    return this.roots.get(rootConsentId);
  }

  async findBranch(rootConsentId: string, passId: string): Promise<RevocationRecord | undefined> {
    return this.branches.get(rootConsentId)?.get(passId);
  }
}

export type RevocationStatus =
  | { revoked: false }
  | { revoked: true; record: RevocationRecord };

export class RevocationService {
  constructor(private readonly repository: RevocationRepository) {}

  async revokeRoot(
    rootConsentId: string,
    reason: string,
    revokedAt = new Date().toISOString(),
  ): Promise<RevocationRecord> {
    const record = RevocationRecordSchema.parse({
      kind: "root",
      rootConsentId,
      revokedAt,
      reason,
    });
    await this.repository.save(record);
    return record;
  }

  async revokeBranch(
    passId: string,
    rootConsentId: string,
    reason: string,
    revokedAt = new Date().toISOString(),
  ): Promise<RevocationRecord> {
    const record = RevocationRecordSchema.parse({
      kind: "branch",
      passId,
      rootConsentId,
      revokedAt,
      reason,
    });
    await this.repository.save(record);
    return record;
  }

  /** Every verifier must call this online (or use a deliberately bounded cache). */
  async checkChain(chain: readonly RelayPass[]): Promise<RevocationStatus> {
    const leaf = chain.at(-1);
    if (!leaf) return { revoked: false };

    const rootRecord = await this.repository.findRoot(leaf.rootConsentId);
    if (rootRecord) return { revoked: true, record: rootRecord };

    for (const pass of chain) {
      const branchRecord = await this.repository.findBranch(leaf.rootConsentId, pass.passId);
      if (branchRecord) return { revoked: true, record: branchRecord };
    }

    return { revoked: false };
  }
}
