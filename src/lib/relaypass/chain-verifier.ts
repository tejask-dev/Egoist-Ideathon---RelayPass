import type { JWK } from "jose";

import { sha256Base64Url } from "./canonical";
import { AttenuationEngine } from "./attenuation-engine";
import { RelayPassError } from "./errors";
import { verifyPassSignature } from "./pass-signer";
import {
  PublicJwkSchema,
  RelayPassSchema,
  type DecisionCode,
  type RelayPass,
} from "./schemas";

const MAX_CHAIN_LENGTH = 17;

export interface TrustedRootKeyStore {
  get(issuerId: string, keyId: string): Promise<JWK | undefined>;
}

export class InMemoryTrustedRootKeyStore implements TrustedRootKeyStore {
  private readonly keys = new Map<string, Map<string, JWK>>();

  register(issuerId: string, keyId: string, publicKey: JWK): void {
    const issuerKeys = this.keys.get(issuerId) ?? new Map<string, JWK>();
    issuerKeys.set(keyId, PublicJwkSchema.parse(publicKey));
    this.keys.set(issuerId, issuerKeys);
  }

  async get(issuerId: string, keyId: string): Promise<JWK | undefined> {
    return this.keys.get(issuerId)?.get(keyId);
  }
}

type ChainFailureCode = Extract<
  DecisionCode,
  | "invalid_chain"
  | "invalid_signature"
  | "untrusted_root"
  | "wrong_delegate"
  | "wrong_audience"
  | "relay_pass_not_yet_valid"
  | "relay_pass_expired"
>;

export type ChainVerificationResult =
  | { valid: true; leaf: RelayPass; chain: RelayPass[] }
  | { valid: false; code: ChainFailureCode; message: string };

type VerifyOptions = {
  expectedAgentId?: string;
  expectedServiceId?: string;
  now?: Date;
};

export class ChainVerifier {
  constructor(
    private readonly roots: TrustedRootKeyStore,
    private readonly attenuation = new AttenuationEngine(),
  ) {}

  async verify(candidates: readonly RelayPass[], options: VerifyOptions = {}): Promise<ChainVerificationResult> {
    if (candidates.length === 0) {
      return { valid: false, code: "invalid_chain", message: "Pass chain is empty" };
    }
    if (candidates.length > MAX_CHAIN_LENGTH) {
      return { valid: false, code: "invalid_chain", message: "Pass chain exceeds the supported depth" };
    }

    const parsed = candidates.map((candidate) => RelayPassSchema.safeParse(candidate));
    const malformed = parsed.find((result) => !result.success);
    if (malformed && !malformed.success) {
      return {
        valid: false,
        code: "invalid_chain",
        message: `Malformed pass: ${malformed.error.issues[0]?.message ?? "unknown error"}`,
      };
    }
    const chain = parsed.map((result) => {
      if (!result.success) throw new Error("Unreachable malformed pass");
      return result.data;
    });
    const root = chain[0];

    if (root.parentPassId !== null || root.parentPassHash !== null || root.delegation.depth !== 0) {
      return { valid: false, code: "invalid_chain", message: "First pass is not a root pass" };
    }

    const trustedRoot = await this.roots.get(root.issuer.id, root.proof.kid);
    if (!trustedRoot) {
      return { valid: false, code: "untrusted_root", message: "Root issuer key is not trusted" };
    }

    try {
      await verifyPassSignature(root, trustedRoot);
    } catch (error) {
      return this.signatureFailure(error);
    }

    for (let index = 1; index < chain.length; index += 1) {
      const parent = chain[index - 1];
      const child = chain[index];

      if (
        child.parentPassId !== parent.passId ||
        child.parentPassHash !== sha256Base64Url(parent.proof.jws) ||
        child.rootConsentId !== parent.rootConsentId ||
        child.proof.kid !== parent.delegate.keyId
      ) {
        return { valid: false, code: "invalid_chain", message: "Parent-child linkage is invalid" };
      }

      try {
        const unsigned = await verifyPassSignature(child, parent.delegate.publicKey);
        this.attenuation.assertCanDerive(parent, unsigned);
      } catch (error) {
        if (error instanceof RelayPassError && error.code === "invalid_derivation") {
          return { valid: false, code: "invalid_chain", message: error.message };
        }
        return this.signatureFailure(error);
      }
    }

    const now = (options.now ?? new Date()).getTime();
    for (const pass of chain) {
      if (now < Date.parse(pass.lifecycle.validFrom)) {
        return {
          valid: false,
          code: "relay_pass_not_yet_valid",
          message: `Pass ${pass.passId} is not active yet`,
        };
      }
      if (now >= Date.parse(pass.lifecycle.validUntil)) {
        return {
          valid: false,
          code: "relay_pass_expired",
          message: `Pass ${pass.passId} has expired`,
        };
      }
    }

    const leaf = chain.at(-1)!;
    if (options.expectedAgentId && leaf.delegate.agentId !== options.expectedAgentId) {
      return { valid: false, code: "wrong_delegate", message: "Requesting agent is not the pass delegate" };
    }
    if (
      options.expectedServiceId &&
      !leaf.audience.allowedServices.includes(options.expectedServiceId)
    ) {
      return { valid: false, code: "wrong_audience", message: "Verifier is outside the pass audience" };
    }

    return { valid: true, leaf, chain };
  }

  private signatureFailure(error: unknown): ChainVerificationResult {
    if (
      error instanceof RelayPassError &&
      (error.code === "invalid_signature" || error.code === "payload_mismatch")
    ) {
      return { valid: false, code: "invalid_signature", message: error.message };
    }
    return {
      valid: false,
      code: "invalid_chain",
      message: error instanceof Error ? error.message : "Unknown chain verification failure",
    };
  }
}
