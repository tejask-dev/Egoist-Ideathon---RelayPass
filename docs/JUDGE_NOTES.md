# RelayPass Judge Notes

Use these answers directly. Do not overclaim the prototype or argue that RelayPass invented capability attenuation.

## 1. Isn't this OAuth?

OAuth controls access to a service. RelayPass controls what happens to a human's approved context and authority when an AI delegates to another AI. The implementation is closer to an attenuated, purpose-bound capability carried across an agent handoff, and it can complement OAuth at a service boundary.

## 2. Isn't attenuation old?

Yes. Cryptographic attenuation and capability systems are prior art. RelayPass's contribution is applying that primitive to Passport-owned human context, visible consumer consent, cross-agent purpose and audience binding, causal receipts, and cascading revocation.

## 3. Why is AI Passport necessary?

AI Passport is the human-controlled source of approved personal context. RelayPass starts only after Maya approves a bounded root permission, then preserves that ceiling through delegation. Without a human context and consent anchor, RelayPass would be a generic agent capability demo.

## 4. Why wouldn't Agent B ask Passport directly?

It can, and Egoist may require that model. Repeated direct prompts can create consent fatigue when Agent B only needs a strict subset of an already approved task. RelayPass proposes safe derivation only when the root explicitly permits delegation; if Passport requires non-transferable passes, `PassportAdapter` changes the handoff to a fresh direct approval.

## 5. Why trust the verifier?

The verifier is the enforcement point: it checks the chain, presenting delegate, audience, purpose, constraints, expiry, replay state, and live revocation before use. Audience binding prevents a pass intended for one service from authorizing another. A malicious verifier can still mishandle data it legitimately receives, so RelayPass minimizes the payload but does not eliminate service trust.

## 6. Why not just tell Nova not to share?

That is an instruction to a model, not an enforceable boundary. A prompt-injected or buggy agent can ignore it, and the receiving service cannot verify it. RelayPass keeps signing, attenuation, verification, disclosure, action enforcement, and revocation in deterministic code outside the model.

## 7. Is the Egoist integration real?

No private Egoist API integration is claimed. The prototype uses a seeded `PassportAdapter` that exposes safe field metadata and releases approved values only after an allow decision. The adapter exists so a validated Egoist flow can replace the mock boundary without weakening the verifier.

## 8. Is this actual A2A?

No. The agents and travel services are deterministic simulations. A2A can move the task; RelayPass makes sure the user's permission survives the handoff. A production A2A transport could carry RelayPass evidence, but it is not implemented here.

## 9. What prevents stolen child passes?

The compact pass alone is insufficient. The presenter must also sign a short-lived request with the child agent's bound Ed25519 key, and the request is bound to the pass, verifier audience, task, purpose, arguments, and request ID. Replay and live revocation checks add protection, while production key custody and workload proof-of-possession remain future work.

## 10. What is actually novel here?

Not attenuation itself. The product insight is that consent is not transitive across AI delegation. RelayPass combines human-readable Passport consent with mechanically shrinking context and authority, verifier-side enforcement, minimum disclosure, receipts, and one-action cascading revocation.

## 11. How is this different from MCP permissions?

MCP permissions generally govern a model's access to a tool or server. RelayPass carries a specific human's bounded consent and authority across agent and service boundaries, where the receiver independently verifies what survived the handoff. They solve different layers and can be used together.

## 12. Why does permission need to travel across tools?

The receiving service cannot safely trust Nova's prompt, configuration, or claim that Maya consented. It needs portable evidence tied to this holder, task, delegate, audience, purpose, and lifetime. That is what lets enforcement survive a change of agent or tool.

## 13. What exactly gets revoked?

Revocation changes the live authorization state of the root consent or a branch. The signed pass remains as historical evidence, but every affected descendant fails its next status check. Root revocation invalidates Nova and every issued specialist without rewriting the signed objects.

## 14. What does a receipt prove?

A receipt is server-generated prototype metadata showing which authenticated policy decision or completed disclosure/action the RelayPass runtime recorded, including requested and disclosed field names and hashed action arguments. It is append-only within the runtime, but it is not currently a signed, third-party, non-repudiable attestation. An argument hash is an integrity and correlation aid, not confidentiality for guessable values.

## 15. What is the first production use case?

A personal assistant delegating one bounded task to integrated specialist services—for example travel coordination or appointment booking—where each receiver needs only a small subset of the person's approved context and authority. Start with a small set of controlled verifiers, short lifetimes, explicit limits, and no payment execution until key custody and atomic side-effect guarantees are production-ready.

## One-line answers worth remembering

> OAuth controls access to a service. RelayPass controls what happens to a human's approved context and authority when an AI delegates to another AI.

> A2A can move the task. RelayPass makes sure the user's permission survives the handoff.

> The model can ask. The deterministic policy layer decides.

> The signed pass still exists. Its authority does not.
