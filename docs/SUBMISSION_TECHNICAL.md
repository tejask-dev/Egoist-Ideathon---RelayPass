# RelayPass Technical Submission

RelayPass is a deterministic authorization layer for consent-preserving AI delegation. Maya approves one bounded permission for Nova; Nova can derive narrower permissions for FlightAgent, StayAgent, and DinnerAgent. A receiving service verifies the full chain before personal context or action authority crosses its boundary.

## Architecture

```text
Maya consent UI
      |
      v
PassportAdapter ---- personal values stay here until allow
      |
RootPassIssuer -> PassSigner -> Nova root pass
                                  |
                         AttenuationEngine
                         /       |       \
                    Flight     Stay     Dinner
                       |         |         |
                       +---- verifier ----+
                              |
                  signature + chain + policy
                              |
               one-use disclosure/action grant
                              |
                    minimum result + receipt
```

The browser sends only one of the fixed demo action names and holds an opaque, random, HTTP-only session cookie. It never submits a pass, policy, context path, price, signing key, or session snapshot as authority.

## Threat model

RelayPass assumes agents and callers may be buggy, prompt-injected, or malicious. It defends against scope expansion, forged or modified passes, invalid parent links, the wrong delegate or verifier, stale or replayed requests, out-of-scope context, excess action authority, and revoked ancestry. Authorization fails closed.

The prototype does not claim to solve a malicious service after legitimate disclosure, compromised agent key custody, atomic revocation against a real external purchase, global federation, denial of service, or legal identity.

## Security invariants

For every parent `P` and child `C`:

```text
Context(C)   subset-of Context(P)
Authority(C) subset-of Authority(P)
Audience(C)  subset-of Audience(P)
Purpose(C)   subset-of Purpose(P)
Expiry(C)    <= Expiry(P)

Restrictions(P) subset-of Restrictions(C)
```

Allowed context, actions, targets, audiences, purposes, limits, lifetimes, and delegation power may stay equal or shrink. `neverDisclose`, `stepUpRequired`, and prohibited-action sets may stay equal or grow. Free-form model output never determines these relations.

## Signing and delegation

- Passes are compact JWS objects signed with Ed25519/EdDSA through `jose`.
- A configured root issuer key anchors Nova's root pass.
- Each child records its root consent, immediate parent ID, canonical parent hash, holder, delegate key, audience, purpose, scope, constraints, delegation depth, and lifecycle.
- Each child is signed by its immediate parent's bound delegate key only after deterministic attenuation succeeds.
- The leaf agent separately signs a short-lived verifier request bound to the pass, service, task, purpose, request ID, requested context, and action arguments.
- Unknown algorithms, malformed proofs, untrusted roots, key substitution, reordered chains, and modified payloads fail verification.

For the public demo, role-separated per-session/per-generation keys are derived from a server-only secret so independent function instances reconstruct the same signed tree without storing private JWKs. Production key management would require rotation and hardened workload or hardware custody.

## Verifier model

Each simulated service has a configured identity and evaluates requests in fail-closed order: schema, signature and chain, delegate, audience, request proof, freshness, task and structured purpose, replay, live revocation, context scope, action target, and typed constraints. An allow result creates an internal one-use grant rather than a reusable client token.

The disclosure or action service consumes that grant, repeats lifecycle and revocation checks immediately before use, then performs the read or deterministic simulated side effect. Success is recorded only after the operation completes.

## Revocation

Revocation is live state, not a claim frozen into the signed pass. Revoking Nova's root invalidates every descendant at the next verifier check while leaving the signed objects and prior receipts intact. A revoked retry returns semantic status `401` with `relay_pass_revoked`. An unavailable status source fails closed.

## Replay prevention

Delegate-signed requests are short-lived and have unique request IDs consumed by the verifier's replay guard. The generic verifier replay cache is in-process in this prototype. The fixed deployed demo separately gains cross-instance idempotence from its durable action journal and compare-and-swap revision; this is not presented as a general distributed nonce service.

## Minimum disclosure

Passes contain authorized field names, not personal values. `PassportAdapter` releases exact values only after a verified allow and an internal one-use disclosure grant. FlightAgent's request for `profile.home_address` is denied before lookup and returns zero disclosed fields. DinnerAgent receives dinner timing and `dietary.nut_free_required = true`; `health.diagnosis` is absent from the pass and result.

## Receipts

Authenticated policy refusals and completed reads/actions generate server-side prototype receipts. They record causal metadata: actor, verifier, task and purpose, pass lineage, requested and disclosed field names, decision, reason, time, and a canonical hash of action arguments. Raw addresses, diagnoses, credentials, private keys, compact JWS strings, and arbitrary action arguments are not receipt fields.

Receipts are append-only application records, not signed or independently non-repudiable attestations. Argument hashes aid integrity and correlation but do not conceal low-entropy inputs.

## Session isolation and serverless persistence

Each browser receives a 256-bit opaque session identifier in an `HttpOnly`, `SameSite=Lax` cookie that is `Secure` in production. The production `DemoSessionRepository` stores one expiring row per session with generation, compare-and-swap revision, clock origin, and an ordered whitelist of completed fixed demo actions. It stores no Passport values, passes, keys, grants, or arbitrary policy.

Every request reconstructs a fresh runtime by replaying that trusted journal. Mutations commit only against the expected generation and revision. Conflicts reload and retry; reset advances the generation and clears only that browser's journal. A stale generation cannot commit after reset. Local development uses the same repository contract in memory. Production requires Supabase and a server signing secret and returns `503` if durable state is unavailable.

## What is real

- Typed consent, issuance, attenuation, signatures, and parent-child linkage.
- Delegate-signed verifier requests, audience and purpose binding, expiry, replay, and live revocation checks.
- Context and action enforcement with typed limits and one-use grants.
- Minimum disclosure, refusals before lookup or side effect, causal receipts, and cascade revocation.
- Browser-session isolation, generation-safe reset, cold reconstruction, and durable compare-and-swap state.

## What is simulated

- Egoist's private Passport API, represented by a seeded `PassportAdapter`.
- FlightAgent, StayAgent, DinnerAgent, and the airline, hotel, and restaurant integrations.
- Travel planning, merchant requests, and purchases.

## Known limitations

- Derived Passport passes are a prototype proposal pending Egoist validation; downstream agents may instead require fresh direct Passport approval.
- Agent keys are demo-derived rather than protected by an HSM or workload identity.
- Generic replay protection is not a distributed nonce service.
- Revocation checks and real external side effects are not transactionally coupled.
- Receipts are not signed third-party attestations.
- Long-lived public operation needs rate limiting, scheduled expiry cleanup, monitoring, and key rotation.
- The prototype is not production A2A, a merchant network, blockchain, or a zero-knowledge system.
