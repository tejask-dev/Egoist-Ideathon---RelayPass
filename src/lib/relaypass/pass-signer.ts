import {
  CompactSign,
  compactVerify,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
} from "jose";

import { canonicalJson } from "./canonical";
import { RelayPassError } from "./errors";
import {
  PublicJwkSchema,
  RelayPassSchema,
  UnsignedVerifierRequestSchema,
  UnsignedRelayPassSchema,
  VerifierRequestSchema,
  type RelayPass,
  type UnsignedRelayPass,
  type UnsignedVerifierRequest,
  type VerifierRequest,
} from "./schemas";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function withoutProof<T extends { proof: unknown }>(value: T): Omit<T, "proof"> {
  const { proof, ...payload } = value;
  void proof;
  return payload;
}

export type PassSignerOptions = {
  issuerId: string;
  keyId: string;
  privateKey: CryptoKey;
  publicKey: JWK;
};

export class PassSigner {
  readonly issuerId: string;
  readonly keyId: string;
  readonly publicKey: JWK;

  private readonly privateKey: CryptoKey;

  constructor(options: PassSignerOptions) {
    this.issuerId = options.issuerId;
    this.keyId = options.keyId;
    this.privateKey = options.privateKey;
    this.publicKey = PublicJwkSchema.parse(options.publicKey);
  }

  static async generate(issuerId: string, keyId: string): Promise<PassSigner> {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    });

    return new PassSigner({
      issuerId,
      keyId,
      privateKey,
      publicKey: await exportJWK(publicKey),
    });
  }

  async sign(unsignedPass: UnsignedRelayPass): Promise<RelayPass> {
    const payload = UnsignedRelayPassSchema.parse(unsignedPass);
    if (payload.issuer.id !== this.issuerId) {
      throw new RelayPassError(
        "invalid_input",
        `Signer ${this.issuerId} cannot issue a pass as ${payload.issuer.id}`,
      );
    }

    const jws = await new CompactSign(encoder.encode(canonicalJson(payload)))
      .setProtectedHeader({ alg: "EdDSA", kid: this.keyId, typ: "relaypass+jws" })
      .sign(this.privateKey);

    return RelayPassSchema.parse({
      ...payload,
      proof: {
        type: "compact-jws",
        alg: "EdDSA",
        kid: this.keyId,
        jws,
      },
    });
  }

  async signVerifierRequest(candidate: UnsignedVerifierRequest): Promise<VerifierRequest> {
    const request = UnsignedVerifierRequestSchema.parse(candidate);
    if (request.agentId !== this.issuerId) {
      throw new RelayPassError(
        "invalid_input",
        `Signer ${this.issuerId} cannot present a request as ${request.agentId}`,
      );
    }

    const jws = await new CompactSign(encoder.encode(canonicalJson(request)))
      .setProtectedHeader({ alg: "EdDSA", kid: this.keyId, typ: "relaypass-request+jws" })
      .sign(this.privateKey);

    return VerifierRequestSchema.parse({
      ...request,
      proof: {
        type: "compact-jws",
        alg: "EdDSA",
        kid: this.keyId,
        jws,
      },
    });
  }
}

export async function verifyPassSignature(
  candidate: RelayPass,
  publicJwk: JWK,
): Promise<UnsignedRelayPass> {
  const pass = RelayPassSchema.parse(candidate);
  let result: Awaited<ReturnType<typeof compactVerify>>;

  try {
    const key = await importJWK(PublicJwkSchema.parse(publicJwk), "EdDSA");
    result = await compactVerify(pass.proof.jws, key, {
      algorithms: ["EdDSA"],
    });
  } catch (error) {
    throw new RelayPassError(
      "invalid_signature",
      "RelayPass signature verification failed",
      [error instanceof Error ? error.message : "Unknown signature failure"],
    );
  }

  if (result.protectedHeader.kid !== pass.proof.kid) {
    throw new RelayPassError("invalid_signature", "JWS key id does not match pass proof");
  }
  if (result.protectedHeader.typ !== "relaypass+jws") {
    throw new RelayPassError("invalid_signature", "JWS type is not relaypass+jws");
  }

  let signedPayload: UnsignedRelayPass;
  try {
    signedPayload = UnsignedRelayPassSchema.parse(JSON.parse(decoder.decode(result.payload)));
  } catch (error) {
    throw new RelayPassError(
      "invalid_signature",
      "Signed RelayPass payload is malformed",
      [error instanceof Error ? error.message : "Unknown payload failure"],
    );
  }

  const presentedPayload = UnsignedRelayPassSchema.parse(withoutProof(pass));
  if (canonicalJson(signedPayload) !== canonicalJson(presentedPayload)) {
    throw new RelayPassError(
      "payload_mismatch",
      "Presented pass fields do not match the signed payload",
    );
  }

  return signedPayload;
}

export async function verifyRequestSignature(
  candidate: VerifierRequest,
  publicJwk: JWK,
): Promise<UnsignedVerifierRequest> {
  const request = VerifierRequestSchema.parse(candidate);
  let result: Awaited<ReturnType<typeof compactVerify>>;

  try {
    const key = await importJWK(PublicJwkSchema.parse(publicJwk), "EdDSA");
    result = await compactVerify(request.proof.jws, key, {
      algorithms: ["EdDSA"],
    });
  } catch (error) {
    throw new RelayPassError(
      "invalid_signature",
      "Verifier request proof is invalid",
      [error instanceof Error ? error.message : "Unknown request proof failure"],
    );
  }

  if (
    result.protectedHeader.kid !== request.proof.kid ||
    result.protectedHeader.typ !== "relaypass-request+jws"
  ) {
    throw new RelayPassError("invalid_signature", "Verifier request proof header is invalid");
  }

  let signedPayload: UnsignedVerifierRequest;
  try {
    signedPayload = UnsignedVerifierRequestSchema.parse(JSON.parse(decoder.decode(result.payload)));
  } catch (error) {
    throw new RelayPassError(
      "invalid_signature",
      "Signed verifier request payload is malformed",
      [error instanceof Error ? error.message : "Unknown request payload failure"],
    );
  }

  const presentedPayload = UnsignedVerifierRequestSchema.parse(withoutProof(request));
  if (canonicalJson(signedPayload) !== canonicalJson(presentedPayload)) {
    throw new RelayPassError(
      "payload_mismatch",
      "Presented verifier request does not match its signed payload",
    );
  }

  return signedPayload;
}
