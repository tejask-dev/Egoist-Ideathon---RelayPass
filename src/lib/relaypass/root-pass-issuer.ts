import { randomUUID } from "node:crypto";

import { RelayPassError } from "./errors";
import { PassSigner } from "./pass-signer";
import {
  RootConsentSchema,
  UnsignedRelayPassSchema,
  type RelayPass,
  type RootConsent,
} from "./schemas";

type IdFactory = () => string;

export class RootPassIssuer {
  constructor(
    private readonly signer: PassSigner,
    private readonly idFactory: IdFactory = () => `rp_${randomUUID()}`,
  ) {}

  async issue(candidate: RootConsent): Promise<RelayPass> {
    const consent = RootConsentSchema.parse(candidate);

    if (consent.issuerId !== this.signer.issuerId) {
      throw new RelayPassError(
        "invalid_input",
        `Root consent expects issuer ${consent.issuerId}, not ${this.signer.issuerId}`,
      );
    }
    const approvedAt = Date.parse(consent.approvedAt);
    if (
      approvedAt < Date.parse(consent.lifecycle.validFrom) ||
      approvedAt > Date.parse(consent.lifecycle.validUntil)
    ) {
      throw new RelayPassError("invalid_input", "Consent approval falls outside pass lifetime");
    }

    const unsigned = UnsignedRelayPassSchema.parse({
      version: "relaypass/0.1",
      passId: this.idFactory(),
      rootConsentId: consent.consentId,
      parentPassId: null,
      parentPassHash: null,
      holder: { pairwiseId: consent.holderPairwiseId },
      issuer: { id: consent.issuerId },
      delegate: consent.requester,
      audience: consent.audience,
      purpose: consent.purpose,
      context: consent.context,
      authority: consent.authority,
      delegation: {
        allowed: true,
        depth: 0,
        maxDepth: consent.maxDelegationDepth,
        mustAttenuate: true,
      },
      lifecycle: consent.lifecycle,
      receiptPolicy: {
        reads: true,
        actions: true,
        writes: true,
        refusals: true,
      },
      revocation: {
        statusAtIssuance: "active",
        rootConsentId: consent.consentId,
        cascade: true,
      },
    });

    return this.signer.sign(unsigned);
  }
}
