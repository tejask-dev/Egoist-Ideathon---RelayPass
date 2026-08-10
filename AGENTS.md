# RelayPass repository instructions

RelayPass is an Agents-track Egoist AI Passport prototype. It lets AI agents delegate work without delegating the human's entire life. The core rule is: consent is not transitive, and every child permission may preserve or reduce authority but must never expand it.

Read before changing behavior:

- `docs/PRODUCT_SPEC.md` - product scope and acceptance criteria
- `docs/ARCHITECTURE.md` - trust model and security invariants
- `docs/DEMO_FLOW.md` - required Maya/Nova demo sequence

## Non-negotiable rules

- Child allowed context, actions, targets, audiences, purposes, lifetimes, limits, and delegation rights must be no broader than the parent.
- Child `neverDisclose`, `stepUpRequired`, and `prohibitedActions` sets must preserve or add restrictions.
- Personal context values stay outside the signed capability and are released only after an allow decision.
- Every authorization decision is deterministic. Never put an LLM in signing, derivation, verification, revocation, disclosure, or action enforcement.
- Verifiers must check live revocation state and fail closed before each disclosure or action.
- Keep the mocked/private Passport boundary behind `PassportAdapter`; do not imply a live private Egoist API integration.
- Narrower derived Passport passes are a prototype proposal pending Egoist validation, not a claim about current Egoist behavior.

Do not change without explicit approval:

- The product thesis, core line, or security invariants.
- The Maya/Nova story or the required `42 -> 7 -> FlightAgent 5 / StayAgent 3 / DinnerAgent 2` Relay Tree.
- The attack/refusal/revocation beats in `docs/DEMO_FLOW.md`.
- The non-goals: no blockchain, zero-knowledge system, production A2A, real airline/hotel integration, or model-driven authorization.

## Required checks

Run all four before handoff:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
