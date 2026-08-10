import { randomUUID } from "node:crypto";

import { canonicalJson, sha256Base64Url } from "./canonical";
import { AttenuationError, RelayPassError } from "./errors";
import { PassSigner } from "./pass-signer";
import {
  ChildPassRequestSchema,
  UnsignedRelayPassSchema,
  type ActionCapability,
  type ChildPassRequest,
  type RelayPass,
  type UnsignedRelayPass,
  type ValueConstraint,
} from "./schemas";

type IdFactory = () => string;

function isSubset<T>(child: readonly T[], parent: readonly T[]): boolean {
  const ceiling = new Set(parent);
  return child.every((item) => ceiling.has(item));
}

function sameScalar(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function constraintIsNoBroader(child: ValueConstraint, parent: ValueConstraint): boolean {
  if (child.kind !== parent.kind) {
    return false;
  }

  switch (parent.kind) {
    case "exact":
      return child.kind === "exact" && sameScalar(child.value, parent.value);
    case "max":
      return child.kind === "max" && child.value <= parent.value;
    case "min":
      return child.kind === "min" && child.value >= parent.value;
    case "oneOf":
      return (
        child.kind === "oneOf" &&
        child.values.every((value) => parent.values.some((candidate) => sameScalar(value, candidate)))
      );
    case "pattern":
      // Proving regex-language inclusion is outside this prototype; equality fails closed.
      return child.kind === "pattern" && child.value === parent.value;
  }
}

function capabilityIssues(child: ActionCapability, parent: ActionCapability): string[] {
  const issues: string[] = [];

  if (!isSubset(child.targets, parent.targets)) {
    issues.push(`action ${child.action} expands target resources`);
  }
  if (parent.requiresHumanApproval && !child.requiresHumanApproval) {
    issues.push(`action ${child.action} removes required human approval`);
  }

  for (const [argument, parentConstraint] of Object.entries(parent.constraints)) {
    const childConstraint = child.constraints[argument];
    if (!childConstraint) {
      issues.push(`action ${child.action} removes constraint ${argument}`);
    } else if (!constraintIsNoBroader(childConstraint, parentConstraint)) {
      issues.push(`action ${child.action} broadens constraint ${argument}`);
    }
  }
  for (const argument of Object.keys(child.constraints)) {
    if (!(argument in parent.constraints)) {
      issues.push(`action ${child.action} adds argument ${argument}`);
    }
  }

  return issues;
}

export class AttenuationEngine {
  constructor(private readonly idFactory: IdFactory = () => `rp_${randomUUID()}`) {}

  assertCanDerive(parent: RelayPass, child: UnsignedRelayPass): void {
    const issues: string[] = [];

    if (child.rootConsentId !== parent.rootConsentId) issues.push("root consent changed");
    if (child.parentPassId !== parent.passId) issues.push("parent pass id is invalid");
    if (child.parentPassHash !== sha256Base64Url(parent.proof.jws)) {
      issues.push("parent pass hash is invalid");
    }
    if (child.issuer.id !== parent.delegate.agentId) issues.push("child issuer is not the parent delegate");
    if (child.holder.pairwiseId !== parent.holder.pairwiseId) {
      issues.push("holder binding changed");
    }
    if (child.delegate.agentId === parent.delegate.agentId) {
      issues.push("child delegate must cross an agent boundary");
    }
    if (!parent.audience.allowedAgents.includes(child.delegate.agentId)) {
      issues.push("child delegate is outside the parent's agent audience");
    }

    if (child.purpose.taskId !== parent.purpose.taskId) issues.push("task id changed");
    if (!isSubset(child.purpose.scopes, parent.purpose.scopes)) issues.push("purpose scope expanded");

    if (!isSubset(child.context.read, parent.context.read)) issues.push("context read set expanded");
    if (!isSubset(child.context.proposeWrites, parent.context.proposeWrites)) {
      issues.push("proposed write set expanded");
    }
    if (!isSubset(parent.context.neverDisclose, child.context.neverDisclose)) {
      issues.push("inherited never-disclose field was removed");
    }
    if (!isSubset(parent.context.stepUpRequired, child.context.stepUpRequired)) {
      issues.push("inherited step-up requirement was removed");
    }

    if (!isSubset(child.audience.allowedAgents, parent.audience.allowedAgents)) {
      issues.push("agent audience expanded");
    }
    if (!isSubset(child.audience.allowedServices, parent.audience.allowedServices)) {
      issues.push("service audience expanded");
    }

    const parentActions = new Map(
      parent.authority.allowedActions.map((capability) => [capability.action, capability]),
    );
    for (const capability of child.authority.allowedActions) {
      const ceiling = parentActions.get(capability.action);
      if (!ceiling) {
        issues.push(`new action added: ${capability.action}`);
      } else {
        issues.push(...capabilityIssues(capability, ceiling));
      }
    }
    if (!isSubset(parent.authority.prohibitedActions, child.authority.prohibitedActions)) {
      issues.push("inherited prohibited action was removed");
    }

    const parentStart = Date.parse(parent.lifecycle.validFrom);
    const parentEnd = Date.parse(parent.lifecycle.validUntil);
    const childStart = Date.parse(child.lifecycle.validFrom);
    const childEnd = Date.parse(child.lifecycle.validUntil);
    if (childStart < parentStart) issues.push("validity starts before parent");
    if (childEnd > parentEnd) issues.push("expiry extends beyond parent");

    if (!parent.delegation.allowed) issues.push("parent prohibits delegation");
    if (child.delegation.depth !== parent.delegation.depth + 1) {
      issues.push("delegation depth is not the next depth");
    }
    if (child.delegation.depth > parent.delegation.maxDepth) {
      issues.push("parent maximum delegation depth exceeded");
    }
    if (child.delegation.maxDepth > parent.delegation.maxDepth) {
      issues.push("maximum delegation depth increased");
    }
    if (!parent.delegation.allowed && child.delegation.allowed) {
      issues.push("delegation privilege increased");
    }

    for (const requirement of ["reads", "actions", "writes", "refusals"] as const) {
      if (parent.receiptPolicy[requirement] && !child.receiptPolicy[requirement]) {
        issues.push(`receipt requirement ${requirement} was removed`);
      }
    }

    if (!child.revocation.cascade) issues.push("cascade revocation was disabled");
    if (child.revocation.rootConsentId !== parent.revocation.rootConsentId) {
      issues.push("revocation root changed");
    }

    if (issues.length > 0) {
      throw new AttenuationError(issues);
    }
  }

  async derive(
    parent: RelayPass,
    candidate: ChildPassRequest,
    signer: PassSigner,
  ): Promise<RelayPass> {
    const request = ChildPassRequestSchema.parse(candidate);

    if (signer.issuerId !== parent.delegate.agentId || signer.keyId !== parent.delegate.keyId) {
      throw new RelayPassError(
        "invalid_input",
        "A child pass must be signed by the parent delegate's bound key",
      );
    }
    if (canonicalJson(signer.publicKey) !== canonicalJson(parent.delegate.publicKey)) {
      throw new RelayPassError(
        "invalid_input",
        "Signer public key does not match the parent delegate binding",
      );
    }

    const child = UnsignedRelayPassSchema.parse({
      version: "relaypass/0.1",
      passId: this.idFactory(),
      rootConsentId: parent.rootConsentId,
      parentPassId: parent.passId,
      parentPassHash: sha256Base64Url(parent.proof.jws),
      holder: { pairwiseId: parent.holder.pairwiseId },
      issuer: { id: parent.delegate.agentId },
      delegate: request.delegate,
      audience: request.audience,
      purpose: request.purpose,
      context: request.context,
      authority: request.authority,
      delegation: {
        allowed: request.delegation.allowed,
        depth: parent.delegation.depth + 1,
        maxDepth: request.delegation.maxDepth,
        mustAttenuate: true,
      },
      lifecycle: request.lifecycle,
      receiptPolicy: parent.receiptPolicy,
      revocation: parent.revocation,
    });

    this.assertCanDerive(parent, child);
    return signer.sign(child);
  }
}
