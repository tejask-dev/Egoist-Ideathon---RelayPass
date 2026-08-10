import { AttenuationEngine } from "./attenuation-engine";
import { ChainVerifier } from "./chain-verifier";
import { RelayPassError } from "./errors";
import { PassSigner } from "./pass-signer";
import { RevocationService } from "./revocation-service";
import type { ChildPassRequest, RelayPass } from "./schemas";

/** Verifies parent provenance and status before invoking the pure attenuation primitive. */
export class DelegationService {
  constructor(
    private readonly verifier: ChainVerifier,
    private readonly revocations: RevocationService,
    private readonly attenuation = new AttenuationEngine(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async derive(
    parentChain: readonly RelayPass[],
    request: ChildPassRequest,
    signer: PassSigner,
  ): Promise<RelayPass> {
    const verification = await this.verifier.verify(parentChain, { now: this.clock() });
    if (!verification.valid) {
      throw new RelayPassError("invalid_chain", verification.message);
    }

    let status;
    try {
      status = await this.revocations.checkChain(verification.chain);
    } catch {
      throw new RelayPassError(
        "invalid_chain",
        "Live revocation status is unavailable; derivation failed closed",
      );
    }
    if (status.revoked) {
      throw new RelayPassError("invalid_chain", "Cannot derive from a revoked parent chain");
    }

    return this.attenuation.derive(verification.leaf, request, signer);
  }
}
