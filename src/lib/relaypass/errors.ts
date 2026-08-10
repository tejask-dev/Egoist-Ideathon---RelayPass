export type RelayPassErrorCode =
  | "invalid_input"
  | "invalid_derivation"
  | "invalid_signature"
  | "payload_mismatch"
  | "untrusted_root"
  | "invalid_chain";

export class RelayPassError extends Error {
  constructor(
    public readonly code: RelayPassErrorCode,
    message: string,
    public readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = "RelayPassError";
  }
}

export class AttenuationError extends RelayPassError {
  constructor(details: readonly string[]) {
    super(
      "invalid_derivation",
      `Child pass would broaden its parent: ${details.join("; ")}`,
      details,
    );
    this.name = "AttenuationError";
  }
}
