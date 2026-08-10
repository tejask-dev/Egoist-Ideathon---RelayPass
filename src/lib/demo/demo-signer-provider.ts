import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
} from "node:crypto";

import { importJWK, type JWK } from "jose";

import { PassSigner } from "../relaypass";
import { DEMO_IDS, type DemoSigners } from "./demo-fixtures";
import { isOpaqueDemoSessionId } from "./demo-session-cookie";

export type DemoSignerCoordinates = {
  sessionId: string;
  generation: number;
};

export interface DemoSignerProvider {
  getSigners(coordinates: DemoSignerCoordinates): Promise<DemoSigners>;
}

const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);
const HKDF_SALT = Buffer.from("relaypass-demo-ed25519-v1", "utf8");

type SignerRole = keyof DemoSigners;

const SIGNER_CONFIG: Record<SignerRole, { issuerId: string; keyLabel: string }> = {
  rootIssuer: { issuerId: DEMO_IDS.issuer, keyLabel: "root" },
  nova: { issuerId: DEMO_IDS.nova, keyLabel: "nova" },
  flight: { issuerId: DEMO_IDS.flight, keyLabel: "flight" },
  stay: { issuerId: DEMO_IDS.stay, keyLabel: "stay" },
  dinner: { issuerId: DEMO_IDS.dinner, keyLabel: "dinner" },
};

function normalizeSecret(secret: string | Uint8Array): Buffer {
  const bytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
  if (bytes.byteLength < 32) {
    throw new Error("RELAYPASS_DEMO_SIGNING_SECRET must contain at least 32 bytes");
  }
  return bytes;
}

function publicJwk(privateKey: ReturnType<typeof createPrivateKey>): JWK {
  return createPublicKey(privateKey).export({ format: "jwk" }) as JWK;
}

export class DeterministicDemoSignerProvider implements DemoSignerProvider {
  private readonly secret: Buffer;

  constructor(secret: string | Uint8Array) {
    this.secret = normalizeSecret(secret);
  }

  async getSigners({ sessionId, generation }: DemoSignerCoordinates): Promise<DemoSigners> {
    if (!isOpaqueDemoSessionId(sessionId)) {
      throw new Error("Cannot derive demo signers for an invalid session ID");
    }
    if (!Number.isInteger(generation) || generation < 0) {
      throw new Error("Cannot derive demo signers for an invalid generation");
    }

    const coordinate = `${sessionId}:${generation}`;
    const keyTag = createHash("sha256").update(coordinate).digest("hex").slice(0, 12);
    const entries = await Promise.all(
      (Object.entries(SIGNER_CONFIG) as Array<
        [SignerRole, (typeof SIGNER_CONFIG)[SignerRole]]
      >).map(async ([role, config]) => {
        const seed = Buffer.from(
          hkdfSync(
            "sha256",
            this.secret,
            HKDF_SALT,
            Buffer.from(`${coordinate}:${config.keyLabel}`, "utf8"),
            32,
          ),
        );
        const keyObject = createPrivateKey({
          key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
          format: "der",
          type: "pkcs8",
        });
        const privateJwk = keyObject.export({ format: "jwk" }) as JWK;
        const privateCryptoKey = await importJWK(privateJwk, "EdDSA");
        if (privateCryptoKey instanceof Uint8Array) {
          throw new Error("Ed25519 key import did not return a CryptoKey");
        }
        const signer = new PassSigner({
          issuerId: config.issuerId,
          keyId: `key_${config.keyLabel}_${keyTag}`,
          privateKey: privateCryptoKey,
          publicKey: publicJwk(keyObject),
        });
        return [role, signer] as const;
      }),
    );

    return Object.fromEntries(entries) as DemoSigners;
  }
}
