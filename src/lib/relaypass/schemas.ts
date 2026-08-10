import { z } from "zod";

const MAX_COLLECTION_ITEMS = 128;
const MAX_ACTION_ARGUMENTS = 64;
const MAX_SCALAR_STRING_LENGTH = 2_000;
const MAX_COMPACT_JWS_LENGTH = 65_536;
const MAX_DELEGATION_DEPTH = 16;

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "Machine identifiers must use stable ASCII characters",
  );
const ContextPathSchema = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    "Expected a lowercase dotted context path",
  );
const IsoTimestampSchema = z.string().datetime({ offset: true });
const ScalarSchema = z.union([
  z.string().max(MAX_SCALAR_STRING_LENGTH),
  z.number().finite(),
  z.boolean(),
]);

function uniqueStrings(schema: z.ZodType<string>) {
  return z.array(schema).max(MAX_COLLECTION_ITEMS).superRefine((items, context) => {
    if (new Set(items).size !== items.length) {
      context.addIssue({ code: "custom", message: "Values must be unique" });
    }
  });
}

export const PublicJwkSchema = z
  .object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
    key_ops: z.array(z.string().max(64)).max(16).optional(),
    ext: z.boolean().optional(),
    alg: z.string().max(64).optional(),
    use: z.string().max(64).optional(),
    kid: z.string().max(200).optional(),
  })
  .strict();

export const AgentIdentitySchema = z.object({
  agentId: IdentifierSchema,
  displayName: z.string().trim().min(1).max(120),
  keyId: IdentifierSchema,
  publicKey: PublicJwkSchema,
}).strict();

export const PurposeSchema = z.object({
  taskId: IdentifierSchema,
  statement: z.string().trim().min(1).max(500),
  scopes: uniqueStrings(IdentifierSchema).min(1),
}).strict();

export const AudienceSchema = z
  .object({
    allowedAgents: uniqueStrings(IdentifierSchema),
    allowedServices: uniqueStrings(IdentifierSchema),
  })
  .strict()
  .superRefine((audience, context) => {
    if (audience.allowedAgents.length === 0 && audience.allowedServices.length === 0) {
      context.addIssue({ code: "custom", message: "At least one audience is required" });
    }
  });

export const ContextPermissionSchema = z
  .object({
    read: uniqueStrings(ContextPathSchema),
    proposeWrites: uniqueStrings(ContextPathSchema),
    neverDisclose: uniqueStrings(ContextPathSchema),
    stepUpRequired: uniqueStrings(ContextPathSchema),
  })
  .strict()
  .superRefine((permission, context) => {
    const unavailable = new Set([...permission.neverDisclose, ...permission.stepUpRequired]);
    for (const path of [...permission.read, ...permission.proposeWrites]) {
      if (unavailable.has(path)) {
        context.addIssue({
          code: "custom",
          message: `${path} cannot be directly allowed and restricted at the same time`,
        });
      }
    }
    for (const path of permission.neverDisclose) {
      if (permission.stepUpRequired.includes(path)) {
        context.addIssue({
          code: "custom",
          message: `${path} cannot be both never-disclose and step-up`,
        });
      }
    }
  });

export const ValueConstraintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), value: ScalarSchema }).strict(),
  z.object({ kind: z.literal("max"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("min"), value: z.number().finite() }).strict(),
  z.object({
    kind: z.literal("oneOf"),
    values: z
      .array(ScalarSchema)
      .min(1)
      .max(MAX_COLLECTION_ITEMS)
      .superRefine((items, context) => {
        const encoded = items.map((item) => JSON.stringify(item));
        if (new Set(encoded).size !== encoded.length) {
          context.addIssue({ code: "custom", message: "oneOf values must be unique" });
        }
      }),
  }).strict(),
  z.object({ kind: z.literal("pattern"), value: z.string().min(1).max(300) }).strict(),
]);

const ConstraintRecordSchema = z
  .record(IdentifierSchema, ValueConstraintSchema)
  .refine(
    (constraints) => Object.keys(constraints).length <= MAX_ACTION_ARGUMENTS,
    `Actions may define at most ${MAX_ACTION_ARGUMENTS} constrained arguments`,
  );

export const ActionCapabilitySchema = z.object({
  action: IdentifierSchema,
  targets: uniqueStrings(IdentifierSchema).min(1),
  constraints: ConstraintRecordSchema,
  requiresHumanApproval: z.boolean(),
}).strict();

export const AuthoritySchema = z
  .object({
    allowedActions: z.array(ActionCapabilitySchema).max(MAX_COLLECTION_ITEMS),
    prohibitedActions: uniqueStrings(IdentifierSchema),
  })
  .strict()
  .superRefine((authority, context) => {
    const allowed = authority.allowedActions.map((item) => item.action);
    if (new Set(allowed).size !== allowed.length) {
      context.addIssue({ code: "custom", message: "Each allowed action must be unique" });
    }

    const prohibited = new Set(authority.prohibitedActions);
    for (const action of allowed) {
      if (prohibited.has(action)) {
        context.addIssue({
          code: "custom",
          message: `${action} cannot be both allowed and prohibited`,
        });
      }
    }
  });

export const DelegationPolicySchema = z
  .object({
    allowed: z.boolean(),
    depth: z.number().int().nonnegative().max(MAX_DELEGATION_DEPTH),
    maxDepth: z.number().int().nonnegative().max(MAX_DELEGATION_DEPTH),
    mustAttenuate: z.literal(true),
  })
  .strict()
  .superRefine((delegation, context) => {
    if (delegation.depth > delegation.maxDepth) {
      context.addIssue({ code: "custom", message: "Delegation depth exceeds its maximum" });
    }
    if (delegation.depth === delegation.maxDepth && delegation.allowed) {
      context.addIssue({
        code: "custom",
        message: "A pass at maximum depth cannot permit further delegation",
      });
    }
  });

export const LifecycleSchema = z
  .object({
    validFrom: IsoTimestampSchema,
    validUntil: IsoTimestampSchema,
  })
  .strict()
  .superRefine((lifecycle, context) => {
    if (Date.parse(lifecycle.validUntil) <= Date.parse(lifecycle.validFrom)) {
      context.addIssue({ code: "custom", message: "validUntil must be after validFrom" });
    }
  });

export const ReceiptPolicySchema = z.object({
  reads: z.boolean(),
  actions: z.boolean(),
  writes: z.boolean(),
  refusals: z.boolean(),
}).strict();

export const RevocationMetadataSchema = z.object({
  statusAtIssuance: z.literal("active"),
  rootConsentId: IdentifierSchema,
  cascade: z.literal(true),
}).strict();

export const UnsignedRelayPassSchema = z
  .object({
    version: z.literal("relaypass/0.1"),
    passId: IdentifierSchema,
    rootConsentId: IdentifierSchema,
    parentPassId: IdentifierSchema.nullable(),
    parentPassHash: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullable(),
    holder: z.object({ pairwiseId: IdentifierSchema }).strict(),
    issuer: z.object({ id: IdentifierSchema }).strict(),
    delegate: AgentIdentitySchema,
    audience: AudienceSchema,
    purpose: PurposeSchema,
    context: ContextPermissionSchema,
    authority: AuthoritySchema,
    delegation: DelegationPolicySchema,
    lifecycle: LifecycleSchema,
    receiptPolicy: ReceiptPolicySchema,
    revocation: RevocationMetadataSchema,
  })
  .strict()
  .superRefine((pass, context) => {
    const isRoot = pass.delegation.depth === 0;
    if (isRoot !== (pass.parentPassId === null && pass.parentPassHash === null)) {
      context.addIssue({
        code: "custom",
        message: "Only root passes may omit parent linkage",
      });
    }
    if (pass.revocation.rootConsentId !== pass.rootConsentId) {
      context.addIssue({ code: "custom", message: "Revocation root must match rootConsentId" });
    }
  });

export const PassProofSchema = z.object({
  type: z.literal("compact-jws"),
  alg: z.literal("EdDSA"),
  kid: IdentifierSchema,
  jws: z.string().min(20).max(MAX_COMPACT_JWS_LENGTH),
}).strict();

export const RelayPassSchema = UnsignedRelayPassSchema.extend({
  proof: PassProofSchema,
});

export const RootConsentSchema = z.object({
  consentId: IdentifierSchema,
  holderPairwiseId: IdentifierSchema,
  issuerId: IdentifierSchema,
  requester: AgentIdentitySchema,
  audience: AudienceSchema,
  purpose: PurposeSchema,
  context: ContextPermissionSchema,
  authority: AuthoritySchema,
  maxDelegationDepth: z.number().int().positive().max(MAX_DELEGATION_DEPTH),
  lifecycle: LifecycleSchema,
  approvedAt: IsoTimestampSchema,
}).strict();

export const ChildPassRequestSchema = z.object({
  delegate: AgentIdentitySchema,
  audience: AudienceSchema,
  purpose: PurposeSchema,
  context: ContextPermissionSchema,
  authority: AuthoritySchema,
  delegation: z.object({
    allowed: z.boolean(),
    maxDepth: z.number().int().nonnegative().max(MAX_DELEGATION_DEPTH),
  }).strict(),
  lifecycle: LifecycleSchema,
}).strict();

export const ActionRequestSchema = z.object({
  name: IdentifierSchema,
  target: IdentifierSchema,
  arguments: z
    .record(IdentifierSchema, ScalarSchema)
    .refine(
      (argumentsValue) => Object.keys(argumentsValue).length <= MAX_ACTION_ARGUMENTS,
      `Actions may contain at most ${MAX_ACTION_ARGUMENTS} arguments`,
    ),
}).strict();

export const UnsignedVerifierRequestSchema = z
  .object({
  requestId: IdentifierSchema,
  passId: IdentifierSchema,
  agentId: IdentifierSchema,
  serviceId: IdentifierSchema,
  taskId: IdentifierSchema,
  purposeScopes: uniqueStrings(IdentifierSchema).min(1),
  issuedAt: IsoTimestampSchema,
  expiresAt: IsoTimestampSchema,
  requestedContext: uniqueStrings(ContextPathSchema),
  action: ActionRequestSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (Date.parse(request.expiresAt) <= Date.parse(request.issuedAt)) {
      context.addIssue({ code: "custom", message: "Request proof must expire after issuance" });
    }
  });

export const RequestProofSchema = z.object({
  type: z.literal("compact-jws"),
  alg: z.literal("EdDSA"),
  kid: IdentifierSchema,
  jws: z.string().min(20).max(MAX_COMPACT_JWS_LENGTH),
}).strict();

export const VerifierRequestSchema = UnsignedVerifierRequestSchema.extend({
  proof: RequestProofSchema,
});

export const DecisionCodeSchema = z.enum([
  "allowed",
  "invalid_request",
  "invalid_chain",
  "invalid_signature",
  "untrusted_root",
  "wrong_delegate",
  "wrong_audience",
  "wrong_purpose",
  "relay_pass_not_yet_valid",
  "relay_pass_expired",
  "relay_pass_revoked",
  "revocation_status_unavailable",
  "request_replayed",
  "unauthorized_context",
  "step_up_required",
  "unauthorized_action",
  "constraint_violation",
]);

const DeniedDecisionCodeSchema = DecisionCodeSchema.exclude(["allowed"]);

export const VerifierDecisionSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      code: z.literal("allowed"),
      semanticStatus: z.literal(200),
      disclosedContext: uniqueStrings(ContextPathSchema),
      message: z.string().min(1),
      receiptId: IdentifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      allowed: z.literal(false),
      code: DeniedDecisionCodeSchema,
      semanticStatus: z.union([z.literal(400), z.literal(401), z.literal(403)]),
      disclosedContext: z.array(ContextPathSchema).max(0),
      message: z.string().min(1),
      receiptId: IdentifierSchema.optional(),
    })
    .strict()
    .superRefine((decision, context) => {
      const expected =
        decision.code === "invalid_request"
          ? 400
          : [
                "invalid_chain",
                "invalid_signature",
                "untrusted_root",
                "relay_pass_not_yet_valid",
                "relay_pass_expired",
                "relay_pass_revoked",
                "revocation_status_unavailable",
                "request_replayed",
              ].includes(decision.code)
            ? 401
            : 403;
      if (decision.semanticStatus !== expected) {
        context.addIssue({ code: "custom", message: "Decision code and status are inconsistent" });
      }
    }),
]);

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type Purpose = z.infer<typeof PurposeSchema>;
export type Audience = z.infer<typeof AudienceSchema>;
export type ContextPermission = z.infer<typeof ContextPermissionSchema>;
export type ValueConstraint = z.infer<typeof ValueConstraintSchema>;
export type ActionCapability = z.infer<typeof ActionCapabilitySchema>;
export type Authority = z.infer<typeof AuthoritySchema>;
export type UnsignedRelayPass = z.infer<typeof UnsignedRelayPassSchema>;
export type RelayPass = z.infer<typeof RelayPassSchema>;
export type RootConsent = z.infer<typeof RootConsentSchema>;
export type ChildPassRequest = z.infer<typeof ChildPassRequestSchema>;
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
export type UnsignedVerifierRequest = z.infer<typeof UnsignedVerifierRequestSchema>;
export type VerifierRequest = z.infer<typeof VerifierRequestSchema>;
export type DecisionCode = z.infer<typeof DecisionCodeSchema>;
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>;
