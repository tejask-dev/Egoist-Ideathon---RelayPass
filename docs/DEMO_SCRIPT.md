# RelayPass 105-Second Demo Script

## Before the timer

Open the demo at the top of the page. Click **Reset demo**, turn on **Presentation mode**, then close the presenter guide. Confirm the journey begins at Permission and no receipt exists.

## Live script

| Time | UI action | Say |
| --- | --- | --- |
| 0–10s | Hold on Maya's AI Passport and its `42 memories`. | “Your personal AI may know your calendar, budget, location, relationships, and preferences. That's useful—until it delegates.” |
| 10–22s | Click **Ask Nova to handle the trip**. Show Can see / Can do / Cannot, then click **Approve for 2 hours**. | “Nova asks Maya for seven pieces of context for one trip and two hours. Maya sees the exact ceiling and intentionally approves it.” |
| 22–34s | Click **Delegate the trip**. Hold on the Relay Tree: `42 → 7 → 5 / 3 / 2`. | “You authorized Nova. You didn't automatically authorize every AI Nova might call. Each child can receive less context or authority—never more.” |
| 34–46s | Open the Airline verifier and click **Verify with Airline**. | “FlightAgent presents its signed child pass. The airline independently checks the signature, parent chain, delegate, audience, purpose, expiry, live status, and the signed six-hundred-fifty-dollar limit.” |
| 46–60s | Click **Request Maya's home address**. Hold on **BLOCKED BEFORE DISCLOSURE** and `0 fields received`. | “The model can ask. But the policy layer doesn't have Maya's address in FlightAgent's permission. It is blocked before disclosure. The Passport value was never fetched.” |
| 60–72s | Open Hotel and click **Attempt $260 hotel booking**. Hold on **ACTION REFUSED**. | “StayAgent tries a two-hundred-sixty-dollar room against its signed two-hundred-twenty-dollar cap. A child can inherit less authority. Never more. No purchase occurs.” |
| 72–82s | Open Restaurant and click **Share dinner minimum**. | “DinnerAgent receives only timing and `nut-free required`. Share the constraint, not the diagnosis.” |
| 82–91s | Hold on the causal receipt tree; select the address or hotel refusal. | “Every completed read, action, and authenticated refusal leaves a causal receipt—without copying Maya's private values into it.” |
| 91–102s | Click **Revoke Nova + descendants**, **Confirm revocation**, then **Retry same FlightAgent pass**. Hold on `401 · relay_pass_revoked`. | “Maya revokes once. The signed pass still exists. Its authority doesn't. A fresh live check stops the same FlightAgent pass and every descendant.” |
| 102–105s | Hold on the revoked result or closing line. | “RelayPass: your consent survives the handoff.” |

## If a click misfires

- Do not improvise a security claim. Click the visible Presentation Mode cue and continue from the real current state.
- If a duplicate click is ignored, wait for the active button label to settle; do not reset mid-story.
- If storage is unavailable, stop. A production `503` is intentional fail-closed behavior, not a demo state to talk around.

## Phrases to keep exact

> You authorized Nova. You didn't automatically authorize every AI Nova might call.

> The model can ask. But the policy layer doesn't have Maya's address in FlightAgent's permission. It is blocked before disclosure.

> A child can inherit less authority. Never more.

> Share the constraint, not the diagnosis.

> The signed pass still exists. Its authority doesn't.

> Your consent survives the handoff.
