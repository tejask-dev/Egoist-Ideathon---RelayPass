# RelayPass Demo Flow

This flow is a product requirement. Do not replace Maya, Nova, the branch names, the scope counts, or the three hero failures without explicit approval.

Target length: 105 seconds  
Track: Agents  
Lane: Build

## What the audience must understand

By the end, a nontechnical viewer should be able to say:

1. Maya authorized Nova, not every AI Nova might contact.
2. Each child receives less context or authority, never more.
3. A receiving service verifies the pass before data or action crosses the boundary.
4. A blocked field is never fetched or disclosed.
5. Revoking Nova's root consent stops every descendant.

Lead with Maya's problem and the shrinking tree. Cryptographic details are supporting evidence, not the opening.

## Required visual contract

The Relay Tree must always present this shape and these counts:

```text
                         MAYA'S PASSPORT
                           42 memories
                                |
                       approved for this task
                                v
                              NOVA
                       7 approved pieces
                                |
                 +--------------+--------------+
                 |              |              |
                 v              v              v
           FLIGHTAGENT      STAYAGENT      DINNERAGENT
          5 permissions    3 permissions    2 contexts
             $650 max         $220 max       no spend
```

The canonical item mapping is:

| Node | Context and authority shown |
| --- | --- |
| Nova - 7 | Origin city, destination, required arrival/dinner time, seat preference, trip budget, nut-free requirement, event area |
| FlightAgent - 5 | Origin city, destination, required arrival time, seat preference, flight booking maximum $650 |
| StayAgent - 3 | Destination, event area, hotel booking maximum $220 |
| DinnerAgent - 2 | Dinner/arrival time, `nut_free_required = true`; no diagnosis and no payment |

Use the umbrella label "approved pieces" or "scoped permissions" where a count combines context paths and an action capability. Do not call the $650/$220 constraint a personal memory value.

## Demo preparation

Reset to a deterministic initial state before every run:

- Maya's Passport shows 42 memories.
- No root pass or child passes exist.
- No branch is revoked.
- The receipt list is empty.
- The demo clock is pinned when the browser session is created so two-hour and child expiries
  remain stable through refreshes while still reading truthfully to a judge.
- Simulated verifier responses and request IDs are stable.
- Context values are available only through the demo `PassportAdapter`.

Never preload a successful or refused result merely as UI state. Root issuance, derivation, signature verification, policy decisions, receipt creation, and revocation must call the real domain code.

## Implemented presentation controls

The Phase 3 build remains one fluid product page. A discreet presentation mode keeps the next
real action visible without replacing the domain flow, and three tabs visibly leave RelayPass
for independent simulated verifier surfaces. The live click order is:

1. `Ask Nova to handle the trip`
2. `Approve for 2 hours`
3. `Delegate the trip`
4. Airline tab: `Verify with Airline`
5. Airline tab: `Request Maya's home address`
6. Hotel tab: `Attempt $260 hotel booking`
7. Restaurant tab: `Share dinner minimum`
8. Inspect the causal receipt tree
9. `Revoke Nova + descendants` -> `Confirm revocation`
10. `Retry same FlightAgent pass`

The successful simulated flight is deterministic at USD $612 under the signed USD $650 maximum.
The header-level `Reset demo` action resets only the current opaque browser session. Local work
uses the in-memory session repository; a multi-instance deployment uses the durable session
adapter. Reset advances the session generation, rebuilds its replay/grant authorities, and keeps
server-held signer material outside the browser. Every mutation returns a fresh client-safe
snapshot from `/api/demo`; the browser never supplies a context path, price, capability, child
policy, session state, or signing key.

## The 105-second script

| Time | Screen and interaction | Spoken line | Technical evidence that must be real |
| --- | --- | --- | --- |
| 0-10s | Open Maya's Passport. Show `42 memories`, with a few sensitive categories visually present but closed. | "Maya's personal AI can know her calendar, travel preferences, budget, relationships, and sensitive constraints. That is useful - until it delegates." | Passport catalog comes through the demo adapter; no blanket pass exists. |
| 10-24s | Maya enters: "Get me to San Francisco tomorrow in time for dinner and handle the trip." Nova requests exactly seven approved pieces for one structured purpose and two hours. Show Can see / Can do / Cannot / Expires. Click Approve. | "Nova asks for only what this trip needs. Maya can edit, deny, or approve this ceiling." | A typed root consent is issued and signed. Sensitive excluded fields never enter it. |
| 24-40s | Animate the Relay Tree from `42 -> 7 -> FlightAgent 5 / StayAgent 3 / DinnerAgent 2`. Open each branch briefly so the count and limits are legible. | "Nova cannot just forward everything. RelayPass creates a smaller, purpose-bound permission for each specialist." | `AttenuationEngine` validates each edge before `PassSigner` signs it. |
| 40-54s | FlightAgent presents its child pass to the simulated airline verifier. Show checks for signature/chain, delegate, audience/purpose, lifetime, live revocation, and `$650` constraint. End on `BOOKING AUTHORIZED`. | "The airline does not trust what the agent says. It verifies exactly what survived the handoff." | Full chain verification, live status lookup, and deterministic constraint evaluation return allowed. |
| 54-68s | Trigger Attack A: FlightAgent requests `profile.home_address`. Show the large refusal card below. | "A bad prompt asks for Maya's home address. The model does not decide. The field was never authorized for this branch, so it is blocked before disclosure." | Policy returns unauthorized context, `disclosedContext: []`; the adapter's value-read method is not called. |
| 68-80s | Trigger Attack B: StayAgent attempts a `$260` hotel booking under its `$220` cap. Show the refusal card below. | "The same rule protects actions. A child may inherit less authority, never more." | Constraint evaluation refuses before the simulated booking side effect. |
| 80-94s | Open the receipt tree. Show the allowed flight event, home-address refusal, hotel refusal, and DinnerAgent's two-item disclosure. | "Every read, action, and refusal leaves a receipt. DinnerAgent gets 'nut-free required,' but never the medical explanation behind it." | Receipts were produced by the real decisions; raw diagnosis is absent. |
| 94-105s | Click `Revoke Nova + descendants`. Retry FlightAgent's formerly valid request. Show `401` and `relay_pass_revoked`. End on the tagline. | "Maya revokes Nova once, and every descendant stops immediately. RelayPass lets agents delegate work without delegating your entire life. Your consent survives the handoff." | The retry performs a new live status lookup; cached issuance state cannot authorize it. |

## Required consent copy

### Nova wants context for one task

Purpose:

> Get Maya to San Francisco tomorrow in time for dinner and handle the trip.

Nova can see:

- Origin city and destination
- Required arrival/dinner time
- Seat preference
- Trip budget
- Nut-free functional requirement
- Event area

Nova can do:

- Search travel
- Delegate travel subtasks within this exact ceiling
- Book only within approved deterministic limits

Nova cannot:

- Read Maya's home address
- Read a diagnosis or medical explanation
- Read private host or relationship details
- Access credentials or unrelated finances
- Send unrelated messages
- Create a child broader than this permission

Ends:

> Two hours after approval, never later than the root consent expiry.

Controls:

`Review exact access` | `Deny` | `Approve for 2 hours`

## Required verifier evidence

The happy-path verifier panel shows human-readable checks in this order:

- Signature and parent chain valid
- Delegate key bound to FlightAgent
- Audience includes this simulated airline verifier
- Purpose is the same task or a structured subset
- Pass is currently active and unexpired
- Live root and branch status are active
- Requested paths are allowed
- Flight total is at or below $650

Technical JSON may be expandable underneath, but it must not displace this summary.

## Required refusal copy

### Attack A - context

Headline:

> BLOCKED BEFORE DISCLOSURE

Body:

> FlightAgent requested `profile.home_address`. Maya did not authorize that context for this task.

Evidence:

- Shared: nothing
- Disclosed context: 0 fields
- Passport value fetch: not called
- A refusal receipt was added

Do not show the address, even masked. The product claim is that the value never crossed this boundary.

### Attack B - action

Headline:

> ACTION REFUSED

Body:

> StayAgent attempted a $260 reservation. Authorized maximum: $220.

Evidence:

- No purchase was made
- Decision: `constraint_violation`
- A refusal receipt was added

### Attack C - revocation

Confirmation:

> Revoke Nova? This immediately revokes Nova, FlightAgent, StayAgent, and DinnerAgent. Existing receipts remain visible. Future reads and actions fail.

Retry result:

```text
401
relay_pass_revoked
Root consent is no longer active.
```

## Receipt tree

The final receipt view should resemble:

```text
Nova
|-- FlightAgent
|   |-- allowed: derived pass verified
|   |-- allowed: flight booking within $650
|   `-- refused: profile.home_address, 0 fields disclosed
|-- StayAgent
|   `-- refused: $260 booking exceeds $220
`-- DinnerAgent
    `-- allowed: dinner time + nut-free requirement only
```

Show event time, agent, verifier, decision, and reason. Keep values and raw action arguments out of the default receipt view.

## State transitions

The UI should follow the domain state, not invent a parallel demo state machine:

1. `unapproved` - no pass exists.
2. `root_active` - Nova's signed pass exists.
3. `children_active` - three verified children exist.
4. `activity_recorded` - allow/refusal receipts exist.
5. `root_revoked` - a live lookup marks the root inactive.
6. `retry_refused` - a new verifier request returns `relay_pass_revoked`.

All buttons should be deterministic and idempotent enough for rehearsal. A Reset demo control may clear only the known demo repository, never unrelated user data.

## Presentation rules

- Use Maya and Nova everywhere. Do not use alternate agent names or a real participant's personal data.
- Keep the 42, 7, 5, 3, and 2 counts visible long enough to read.
- Make context cards physically smaller farther from Maya.
- Say "simulated verifier" and "prototype PassportAdapter" where relevant.
- Do not say RelayPass is an official Egoist feature.
- Do not claim novelty for capability attenuation itself. The product contribution is its application to human-owned Passport context, consumer consent UX, and receipt/revocation flow.
- Never use an LLM to choose an allow/deny result. Fixed agent requests are an honest demo of the enforcement layer.
- Avoid a JSON wall, standards lecture, crypto-wallet styling, or enterprise security-dashboard framing.

## Organizer validation disclosure

If asked whether Egoist currently supports derived passes, answer directly:

> Narrower derived passes are our prototype proposal for what consent-preserving agent handoffs could look like. We have kept the real Passport integration behind `PassportAdapter` because Egoist may instead require every downstream agent to obtain a fresh direct pass. That answer changes the adapter and approval step, not our deterministic least-privilege verifier.

## Demo acceptance checklist

- [ ] Maya and Nova naming is consistent.
- [ ] The tree reads exactly `42 -> 7 -> FlightAgent 5 / StayAgent 3 / DinnerAgent 2`.
- [ ] DinnerAgent receives the functional nut-free requirement and no diagnosis.
- [ ] A real root/child signature chain verifies on the happy path.
- [ ] FlightAgent's address request returns zero disclosed fields before any value lookup.
- [ ] StayAgent's $260 attempt produces no action under the $220 limit.
- [ ] Allowed and refused events appear as receipts.
- [ ] Root revocation causes a new live check and `relay_pass_revoked` for every descendant.
- [ ] Simulated integrations and the derived-pass assumption are labeled honestly.
- [ ] The close uses the core line and tagline.
- [ ] All repository checks pass:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```
