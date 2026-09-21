# RelayPass

> Your consent survives the handoff.

RelayPass lets AI agents delegate work without delegating your entire life. Maya approves one narrow, two-hour permission for Nova; Nova can hand smaller signed permissions to specialist agents, and each receiving service independently verifies what survived the handoff before context or authority crosses its boundary.

```text
Maya's Passport 42 → Nova 7 → FlightAgent 5 / StayAgent 3 / DinnerAgent 2
```

## Problem

Consent is not transitive. You may authorize one AI with personal context and authority, but that does not automatically authorize every AI it calls. A flight agent may need an origin and arrival window, not a home address. A restaurant may need a nut-free requirement, not the diagnosis behind it.

## How RelayPass Works

```text
Human approval
  → Passport permission
  → root agent
  → attenuated child passes
  → independent verifiers
  → minimum disclosure / bounded action
  → causal receipts
  → live cascading revocation
```

Maya sees the exact root ceiling. RelayPass signs it for Nova, mechanically narrows every child across context, actions, targets, audience, purpose, limits, expiry, and delegation, and rejects any attempted expansion. A verifier checks the signed chain and live status before each disclosure or action.

## Core Invariant

```text
Context(child)   ⊆ Context(parent)
Authority(child) ⊆ Authority(parent)
Expiry(child)    ≤ Expiry(parent)

Restrictions(child) ⊇ Restrictions(parent)
```

A downstream agent may receive less. Never more.

## Demo

Node 22 is required.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, turn on **Presentation mode**, and follow the live cue:

1. Ask Nova to handle Maya's San Francisco trip.
2. Review the seven-piece ceiling and approve it for two hours.
3. Delegate into the `5 / 3 / 2` specialist tree.
4. Let the simulated airline verify FlightAgent and authorize a `$612` flight under `$650`.
5. Request `profile.home_address`; observe `BLOCKED BEFORE DISCLOSURE`, zero fields, and no Passport fetch.
6. Attempt a `$260` hotel booking under StayAgent's `$220` maximum; no purchase occurs.
7. Give DinnerAgent only timing and `nut_free_required = true`, never the diagnosis.
8. Inspect the causal receipt tree.
9. Revoke Nova and every descendant, then retry the same FlightAgent pass and receive `401 · relay_pass_revoked`.

**Reset demo** advances only the current browser session's generation.

## What Is Real

- Typed root issuance and monotonic child derivation.
- Ed25519/EdDSA signed passes, immediate-parent hashes, and full-chain verification.
- Delegate-signed, audience-, task-, and purpose-bound verifier requests.
- Deterministic lifecycle, replay, constraint, and live revocation checks outside any model.
- One-use disclosure/action grants with a second check immediately before use.
- Passport values kept outside passes and released through `PassportAdapter` only after allow.
- Context and action refusals before value lookup or simulated side effect.
- Server-generated causal receipts and cascade revocation.
- Per-browser isolation, generation-safe reset, compare-and-swap updates, cold reconstruction, and durable production state.

## What Is Simulated

- Egoist's private Passport API; the demo uses a seeded `PassportAdapter`.
- FlightAgent, StayAgent, DinnerAgent, and the airline, hotel, and restaurant services.
- Autonomous trip planning, merchant requests, and purchases.

## Why AI Passport

AI Passport owns the human's approved context and consent boundary. RelayPass addresses the next question: what happens when that authorized AI hands part of the task to another AI? The proposed child pass preserves the Passport ceiling through the handoff; if Egoist instead requires every downstream app to obtain a fresh direct pass, the adapter and approval step change while the least-privilege verifier, receipts, and revocation experience remain.

## Security

- Zod schemas validate trust boundaries and reject unknown policy shapes.
- No LLM participates in signing, attenuation, verification, disclosure, action enforcement, replay, or revocation.
- Values such as Maya's address and diagnosis are not embedded in passes, receipts, cookies, or durable session rows.
- The public route accepts only fixed action names; the browser cannot submit policy or fake receipts.
- The session cookie is opaque and `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Production fails with `503` when durable state or the signing secret is unavailable; it never falls back to shared process memory.
- Receipts are append-only server records for the prototype, not signed third-party or non-repudiable attestations.

See [the architecture and threat model](docs/ARCHITECTURE.md) and [the technical submission](docs/SUBMISSION_TECHNICAL.md) for exact trust boundaries and limitations.

## Tests

The current suite contains **164 tests** covering attenuation, signatures, verifier binding, replay, disclosure, limits, revocation, receipts, concurrency, cold reconstruction, and session isolation.

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

[GitHub Actions CI](https://github.com/tejask-dev/Egoist-Ideathon---RelayPass/actions/workflows/ci.yml) runs these four checks for every pull request and push to `main`. It installs locked dependencies with `npm ci` and uses the Node.js range in `package.json` (`>=22.12 <23`). CI needs no production credentials; deployment smoke checks remain a separate step.

After deployment, exercise the real HTTP boundary with two isolated cookie jars:

```bash
npm run smoke -- https://<deployment-host>
```

## Architecture

```text
Browser (opaque HttpOnly session cookie)
  |
  v
DemoSessionCoordinator -- compare-and-swap --> DemoSessionRepository
  |                                              |-- memory (local/test)
  |                                              `-- Supabase (production)
  `-- reconstruct trusted fixed-action journal
         |
PassportAdapter -> RootPassIssuer -> AttenuationEngine -> PassSigner
                                            |
                              ChainVerifier + PolicyEvaluator
                                            |
                         one-use disclosure/action service
                                            |
                              receipts + live revocation
```

The durable row contains only a random session lookup identifier, generation, revision, expiry, clock origin, and an ordered whitelist of completed demo actions. It contains no Passport values, JWS proofs, private keys, reusable grants, or caller-authored policy.

## Deployment

Production requires Supabase and fails closed without it.

1. Apply [`supabase/migrations/202608100001_relaypass_demo_sessions.sql`](supabase/migrations/202608100001_relaypass_demo_sessions.sql) to the production Supabase project.
2. Configure these server-side variables in Vercel:

   ```text
   RELAYPASS_DEMO_STORE=supabase
   RELAYPASS_DEMO_SIGNING_SECRET=<at least 32 random bytes>
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_<server-only key>
   ```

3. Deploy, then run `npm run smoke -- https://<deployment-host>` and complete [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).

Never prefix either secret with `NEXT_PUBLIC_`. No production credential belongs in `.env.example`, source control, browser code, logs, or screenshots.

## Limitations

- Narrower derived Passport passes are a prototype proposal pending Egoist validation, not a claim about current Egoist behavior.
- The demo is one fixed story with simulated verifiers, not production A2A or a merchant network.
- Demo-derived agent keys are not production key custody; a real deployment needs rotation and hardware/workload proof-of-possession.
- The generic verifier replay guard is in-process; durable journal/CAS protects this fixed public demo, not arbitrary distributed nonces.
- Live status checks are not transactionally coupled to a real external side effect.
- Receipt argument hashes are integrity/correlation aids, not confidentiality for guessable values.
- Long-lived public operation needs rate limiting, monitoring, and scheduled expired-session cleanup.
- RelayPass does not implement blockchain, zero-knowledge proofs, or a full verifiable-credential stack.

**Your consent survives the handoff.**
