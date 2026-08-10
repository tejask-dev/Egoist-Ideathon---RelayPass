import { z } from "zod";

import { RelayPassError } from "./errors";
import { RevocationService } from "./revocation-service";
import type { RelayPass } from "./schemas";

const PassportValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const PassportMemorySchema = z.object({
  path: z.string().min(1),
  value: PassportValueSchema,
  sensitivity: z.enum(["standard", "sensitive", "restricted"]),
}).strict();

export type PassportMemory = z.infer<typeof PassportMemorySchema>;

export type ContextReleaseGrant = Readonly<{
  requestId: string;
  passId: string;
}>;

type StoredGrant = {
  chain: readonly RelayPass[];
  paths: readonly string[];
  expiresAt: number;
};

/**
 * Creates one-use, in-process disclosure grants. The WeakMap is the security
 * boundary: a caller cannot forge a structurally similar object and replayed
 * grants are rejected. Cross-process deployments should replace this with a
 * short-lived signed grant plus a distributed replay store.
 */
export interface ContextGrantIssuer {
  issue(
    chain: readonly RelayPass[],
    paths: readonly string[],
    requestId: string,
    expiresAt: Date,
  ): ContextReleaseGrant;
}

export interface ContextGrantConsumer {
  consume(
    grant: ContextReleaseGrant,
    now: Date,
  ): Promise<{ pass: RelayPass; paths: string[] }>;
}

class ContextReleaseAuthority implements ContextGrantIssuer, ContextGrantConsumer {
  private readonly grants = new WeakMap<ContextReleaseGrant, StoredGrant>();

  constructor(private readonly revocations: RevocationService) {}

  issue(
    chain: readonly RelayPass[],
    paths: readonly string[],
    requestId: string,
    expiresAt: Date,
  ): ContextReleaseGrant {
    const leaf = chain.at(-1);
    if (!leaf) throw new RelayPassError("invalid_input", "Cannot authorize an empty chain");

    const ceiling = new Set(leaf.context.read);
    if (
      paths.some(
        (path) =>
          !ceiling.has(path) ||
          leaf.context.neverDisclose.includes(path) ||
          leaf.context.stepUpRequired.includes(path),
      )
    ) {
      throw new RelayPassError("invalid_input", "Disclosure grant exceeds the verified leaf pass");
    }

    const grant = Object.freeze({ requestId, passId: leaf.passId });
    this.grants.set(grant, {
      chain: [...chain],
      paths: [...paths],
      expiresAt: expiresAt.getTime(),
    });
    return grant;
  }

  async consume(
    grant: ContextReleaseGrant,
    now: Date,
  ): Promise<{ pass: RelayPass; paths: string[] }> {
    const stored = this.grants.get(grant);
    this.grants.delete(grant);

    const leaf = stored?.chain.at(-1);
    if (!stored || !leaf || grant.passId !== leaf.passId) {
      throw new RelayPassError("invalid_input", "Disclosure grant is invalid or already consumed");
    }
    if (now.getTime() >= stored.expiresAt) {
      throw new RelayPassError("invalid_input", "Disclosure grant has expired");
    }
    if (
      stored.chain.some(
        (pass) =>
          now.getTime() < Date.parse(pass.lifecycle.validFrom) ||
          now.getTime() >= Date.parse(pass.lifecycle.validUntil),
      )
    ) {
      throw new RelayPassError("invalid_input", "Pass chain is inactive at context release time");
    }

    let status;
    try {
      status = await this.revocations.checkChain(stored.chain);
    } catch {
      throw new RelayPassError(
        "invalid_input",
        "Live revocation status is unavailable; disclosure failed closed",
      );
    }
    if (status.revoked) {
      throw new RelayPassError("invalid_input", "Pass was revoked before context release");
    }

    return { pass: leaf, paths: [...stored.paths] };
  }
}

export function createContextGrantAuthority(
  revocations: RevocationService,
): { issuer: ContextGrantIssuer; consumer: ContextGrantConsumer } {
  const authority = new ContextReleaseAuthority(revocations);
  return {
    issuer: Object.freeze({ issue: authority.issue.bind(authority) }),
    consumer: Object.freeze({ consume: authority.consume.bind(authority) }),
  };
}

export interface PassportAdapter {
  listMemoryMetadata(): Promise<Array<Omit<PassportMemory, "value">>>;
  releaseAuthorizedContext(
    grant: ContextReleaseGrant,
  ): Promise<Record<string, z.infer<typeof PassportValueSchema>>>;
}

/**
 * Prototype boundary for Egoist Passport semantics. It intentionally exposes no
 * private Egoist API claims and releases values only after deterministic policy approval.
 */
export class InMemoryPassportAdapter implements PassportAdapter {
  private readonly memories: Map<string, PassportMemory>;

  constructor(
    private readonly holderPairwiseId: string,
    seed: readonly PassportMemory[],
    private readonly releaseAuthority: ContextGrantConsumer,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.memories = new Map(seed.map((memory) => {
      const parsed = PassportMemorySchema.parse(memory);
      return [parsed.path, parsed];
    }));
  }

  async listMemoryMetadata(): Promise<Array<Omit<PassportMemory, "value">>> {
    return [...this.memories.values()].map(({ path, sensitivity }) => ({ path, sensitivity }));
  }

  async releaseAuthorizedContext(
    grant: ContextReleaseGrant,
  ): Promise<Record<string, z.infer<typeof PassportValueSchema>>> {
    const { pass, paths: authorizedPaths } = await this.releaseAuthority.consume(
      grant,
      this.clock(),
    );
    if (pass.holder.pairwiseId !== this.holderPairwiseId) {
      throw new RelayPassError("invalid_input", "Disclosure grant belongs to a different holder");
    }

    return Object.fromEntries(
      authorizedPaths.map((path) => {
        const memory = this.memories.get(path);
        if (!memory) {
          throw new RelayPassError("invalid_input", `Passport memory is unavailable: ${path}`);
        }
        return [path, memory.value];
      }),
    );
  }
}
