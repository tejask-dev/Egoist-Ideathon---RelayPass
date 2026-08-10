# RelayPass Product Specification

Status: competition prototype specification  
Track: Agents  
Lane: Build

## Source hierarchy

The [official AI Passport Ideathon participant guide](./ideathon-information.pdf) is authoritative for competition requirements. It asks an Agents-track entry to name the holder, agent, and verifier; define scope and expiry or revocation; show an action receipt; and explain what happens outside scope. It also prioritizes a real problem, minimum disclosure, portability across tools, and a first version a stranger can understand in one minute.

The [RelayPass build strategy](<./Winning the Egoist Machines AI Passport Ideathon_ Agents-Track Build Strategy.pdf>) is research and architecture guidance, not an Egoist specification. This document corrects its illustrative attenuation pseudocode where necessary. The repository brief fixes the product name, characters, security invariants, and demo counts.

## Product thesis

Consent is not transitive.

Authorizing one AI to receive personal context and perform a task does not authorize every agent it later contacts to inherit the same context or authority.

Core product line:

> RelayPass lets AI agents delegate work without delegating your entire life.

Tagline:

> Your consent survives the handoff.

RelayPass starts with a human-approved root permission and creates a verifiable child permission for each handoff. A child may preserve or reduce what its parent had. It can never add context, actions, targets, spend, audience, purpose, lifetime, or delegation power. Reads, actions, refusals, and revocations produce receipts.

## Competition claim

This entry is for people using multi-agent AI assistants, who need to prove that a delegated agent has permission to receive specific context and perform specific actions to a receiving service, so they can delegate complex tasks without giving away more personal context or authority than necessary.

### Named roles

- Holder: Maya, the person who owns the Passport context and grants consent.
- Root agent: Nova, Maya's general personal assistant.
- Delegates: FlightAgent, StayAgent, and DinnerAgent.
- Verifiers: simulated airline, hotel, and restaurant service gateways.
- Prototype issuer: RelayPass behind a `PassportAdapter`, standing in for an integration contract that Egoist must validate.

## User problem

Maya's personal AI can be useful because it knows her schedule, preferences, budget, relationships, and sensitive constraints. The risk appears when Nova delegates. Voluntary instructions such as "do not share my address" are not an enforceable boundary, and approving every harmless handoff would create consent fatigue.

RelayPass gives the receiving agent or service a machine-verifiable answer to four questions:

1. Did this task descend from Maya's active consent?
2. Which context paths and actions survived this handoff?
3. Which limits, purpose, audience, and expiry apply now?
4. Has Maya revoked the root or this branch?

## Canonical demo story

Maya tells Nova:

> Get me to San Francisco tomorrow in time for dinner and handle the trip.

Maya's Passport contains 42 memories, including useful and sensitive context. The root request must exclude `profile.home_address`, `health.diagnosis`, `relationships.host_private_details`, credentials, and unrelated financial information.

Maya approves seven context paths for Nova:

1. `travel.origin_city`
2. `travel.destination`
3. `calendar.required_arrival_time`
4. `travel.seat_preference`
5. `commerce.trip_budget`
6. `dietary.nut_free_required`
7. `trip.event_area`

Nova's root authority separately permits trip search, bounded travel booking, and delegation to the named specialists under a $900 trip ceiling. Those action capabilities are not Passport memories. FlightAgent's $650 and StayAgent's $220 capabilities must be deterministic narrowings of that root authority, never newly invented actions.

The signature Relay Tree is a product requirement:

| Node | Required visible count | Visible scoped items |
| --- | ---: | --- |
| Maya's Passport | 42 memories | Rich user-owned context; no app has blanket access |
| Nova | 7 approved pieces | The seven approved context paths above |
| FlightAgent | 5 scoped permissions | Origin, destination, required arrival time, seat preference, and `flight.book` capped at $650 |
| StayAgent | 3 scoped permissions | Destination, event area, and `hotel.book` capped at $220 |
| DinnerAgent | 2 pieces of context | Dinner/arrival time and `nut_free_required = true`; no diagnosis and no spending |

The counts describe the human-readable permission items shown in the tree. Context values such as Toronto or the health rationale are not embedded in the signed pass. A pass contains authorized paths and deterministic policy literals such as action ceilings; approved personal values are retrieved separately only after verification.

## Goals

- Make consent attenuation visible and understandable in under one minute.
- Enforce context, authority, audience, purpose, lifetime, and delegation monotonicity with deterministic TypeScript.
- Use Zod at trust boundaries and real Ed25519/EdDSA signing and verification through `jose`.
- Bind each pass to its delegate and cryptographically link it to its parent.
- Deny out-of-scope context before any value is fetched or disclosed.
- Deny actions that exceed a signed capability constraint before side effects occur.
- Check live root and branch revocation state before every disclosure or action.
- Preserve receipts for allowed actions and refusals after access is revoked.
- Keep an honest, replaceable `PassportAdapter` between RelayPass and the mocked Passport source.

## Functional requirements

### Root consent

- Nova requests exact context paths for a structured purpose and bounded duration.
- Maya can approve, edit, or deny the request.
- The approval UI summarizes Can see, Can do, Cannot do, and Expires.
- Root issuance records the holder, requester, audience, purpose scopes, context paths, action capabilities, delegation ceiling, and lifecycle.
- Sensitive values remain in the Passport data source until a verified request is allowed.

### Child derivation

- A child references the same root consent and the immediate parent ID and hash.
- Derivation validates every attenuation dimension before signing.
- Any expansion attempt returns a typed refusal and produces no child pass.
- Safe child derivation may occur without another prompt only within the already approved purpose ceiling.
- Anything broader becomes a new human consent request; it is never silently treated as a child.

### Verification and disclosure

- A receiving verifier validates schema, signature, parent linkage, the full chain, delegate binding, audience, purpose, lifecycle, live revocation, context scope, action scope, targets, and constraints.
- Verification fails closed with a stable semantic decision code.
- Context values are fetched through `PassportAdapter` only after an `allowed` decision.
- A refusal returns `disclosedContext: []` and does not fetch the blocked value.

### Receipts

- Reads, allowed actions, refused actions, refused context, step-up requests, write proposals, and revocations create receipts.
- Receipts identify the pass, agent, verifier, purpose, requested paths, disclosed paths, decision, reason, and time.
- Receipts hash action arguments rather than storing unnecessary sensitive raw values.
- Receipts remain visible after revocation.

### Revocation

- Maya can revoke a child branch or Nova's root consent.
- Root revocation invalidates every descendant without needing to rewrite every pass.
- Every verifier performs a live status check immediately before disclosure or action.
- A revoked pass returns a 401-style semantic result with code `relay_pass_revoked`.
- An unavailable revocation source fails closed; issuance-time status is never sufficient.

## Hero failure cases

### A. Blocked context before disclosure

FlightAgent requests `profile.home_address`.

- Result: `BLOCKED BEFORE DISCLOSURE`.
- No Passport value is fetched or returned.
- No sensitive field enters the child pass or disclosed payload.
- A refusal receipt records zero disclosed context.

### B. Action outside the child limit

StayAgent attempts a $260 hotel booking under a $220 maximum.

- Result: `ACTION REFUSED` with a constraint violation.
- No simulated purchase occurs.
- A refusal receipt records the attempt without exposing unrelated values.

### C. Cascade revocation

Maya revokes Nova's root permission, then FlightAgent retries a previously valid request.

- Result: semantic status 401 and code `relay_pass_revoked`.
- Nova and all three descendant branches are invalid.
- Existing receipts remain visible.

## Security and privacy requirements

All relations are evaluated against the immediate parent and then rechecked as part of full-chain verification.

- Allowed context, proposed writes, actions, targets, audiences, and purpose scopes: child is a subset of parent.
- Numeric maxima decrease or stay equal; numeric minima increase or stay equal; enumerations shrink; exact constraints remain equal.
- Child validity starts no earlier and ends no later than the parent's validity.
- Delegation depth increments exactly once and never exceeds the inherited ceiling.
- `neverDisclose`, `stepUpRequired`, and `prohibitedActions` are restriction sets: the child preserves every parent restriction and may add more.
- Requiring human approval is monotonic: a child may add approval, never remove an inherited requirement.
- Free-form model output is never an authorization input. Purpose and policy comparisons use structured fields.
- Every denial is fail closed and releases no data or side effect.

Detailed rules are in [ARCHITECTURE.md](./ARCHITECTURE.md).

## UX requirements

- Consumer AI product, not an enterprise admin console, crypto wallet, generic dashboard, or JSON wall.
- Calm, premium visual language with strong typography and generous whitespace.
- The first screen explains the human problem before token or standards details.
- Context visibly shrinks as it moves away from Maya.
- Allowed is green, refused is red, and step-up is amber; color is reinforced with text and icons.
- Technical chain details are available progressively but secondary to human-readable scope.
- The exact flow in [DEMO_FLOW.md](./DEMO_FLOW.md) is a product requirement, not optional demo polish.

## Non-goals

- No blockchain.
- No zero-knowledge proof system or full verifiable-credential stack.
- No production A2A implementation.
- No autonomous model behavior required for the demo.
- No real airline, hotel, restaurant, banking, payment, or booking integration.
- No claim of production-grade identity, key management, replay protection, or legal authority.
- No broad identity network, agent marketplace, enterprise dashboard, or unrelated Passport use case.
- No direct durable Passport writes by delegates; a future write path only proposes changes for review.
- No LLM-driven authorization, scope comparison, constraint evaluation, or revocation decision.

## Explicit unresolved assumption

RelayPass's narrower derived passes are a prototype proposal, not a documented Egoist API capability. Egoist's current consent model may require every downstream application to obtain a fresh direct Passport pass. This must be validated with Egoist.

Until then:

- All mocked/private Passport behavior remains behind `PassportAdapter`.
- Product copy says "proposed derived RelayPass" or "technical prototype," never "current Egoist feature."
- If Egoist requires non-transferable passes, `PassportAdapter` changes the handoff to a fresh, holder-approved pass for the downstream agent. The tree, delta request, deterministic verifier, receipts, and step-up UX remain useful.

## MVP acceptance criteria

- The Relay Tree renders exactly `42 -> 7 -> FlightAgent 5 / StayAgent 3 / DinnerAgent 2` and uses Maya/Nova naming everywhere.
- A real signed root and child chain verifies; tampering, an invalid parent link, and an invalid signature fail.
- Every required pass and failure test in `ARCHITECTURE.md` passes.
- Attack A discloses zero values, Attack B creates no side effect, and Attack C returns `relay_pass_revoked` after a live status check.
- DinnerAgent receives the functional nut-free requirement but never the diagnosis.
- The demo labels Passport and service integrations honestly as adapters/simulations.
- A nontechnical viewer can explain why the child sees less and what revocation does.
- All required repository checks pass:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```
