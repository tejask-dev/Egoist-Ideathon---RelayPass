# RelayPass Release Checklist

Release owner: ____________________  
Candidate commit: ____________________  
Production URL: ____________________  
Checked at (UTC): ____________________

## Durable production boundary

- [ ] Supabase project is owned by the release account.
- [ ] Supabase migration applied.
- [ ] Migration constraints and compare-and-swap update verified against the target project.
- [ ] Expired-session cleanup is enabled or an owner/date is recorded.
- [ ] Production server secret configured.
- [ ] `RELAYPASS_DEMO_SIGNING_SECRET` is at least 32 random bytes and server-only.
- [ ] `SUPABASE_SECRET_KEY` is a server-only `sb_secret_…` key.
- [ ] No secret is prefixed with `NEXT_PUBLIC_`.
- [ ] Vercel variables configured for Production.
- [ ] Preview environments either have isolated credentials or remain intentionally fail-closed.

## Deploy and HTTP verification

- [ ] Deployment successful.
- [ ] Production smoke tests pass: `npm run smoke -- https://<deployment-host>`.
- [ ] Health, API, cookie, origin, and security-header behavior checked on the deployed host.
- [ ] Missing or unavailable durable storage returns `503`; no memory fallback occurs.
- [ ] Two concurrent sessions verified.
- [ ] Judge A revoking/resetting does not alter Judge B.
- [ ] Reset works and advances only the current session generation.

## Authorization and privacy

- [ ] Home address never disclosed.
- [ ] Address refusal reports zero disclosed fields and no Passport value fetch.
- [ ] Diagnosis never disclosed.
- [ ] DinnerAgent receives only dinner timing and `nut_free_required = true`.
- [ ] Hotel limit enforced: `$260` refused against `$220`.
- [ ] No simulated purchase occurs after the hotel refusal.
- [ ] Root revocation cascades.
- [ ] Revoked retry fails with `401 · relay_pass_revoked`.
- [ ] Old-generation state cannot commit or replay after reset.
- [ ] Receipts describe completed/authenticated events accurately and expose no private values.

## Demo rehearsal

- [ ] Presentation Mode works.
- [ ] Presenter guide copy matches `docs/DEMO_SCRIPT.md`.
- [ ] Complete 90–105 second path rehearsed without shortcuts.
- [ ] Twenty consecutive local runs complete successfully.
- [ ] Desktop viewport checked at `1440×900`.
- [ ] Desktop viewport checked at `1280×800`.
- [ ] Tablet viewport checked at `768×900`.
- [ ] Keyboard can enter, operate, and exit the guide and revocation dialog.
- [ ] Relay Tree reads `42 → 7 → 5 / 3 / 2` in five seconds.
- [ ] `BLOCKED BEFORE DISCLOSURE` is legible from presentation distance.
- [ ] Revoked retry result is legible from presentation distance.
- [ ] Console clean.
- [ ] Server logs clean.

## Repository and submission

- [ ] `npm run test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] No secrets committed.
- [ ] `.env`, `.env.local`, private keys, browser profiles, screenshots, recordings, and temporary logs are ignored or outside the repository.
- [ ] README updated.
- [ ] `docs/JUDGE_NOTES.md` reviewed by presenter.
- [ ] `docs/SUBMISSION_TECHNICAL.md` matches the release.
- [ ] Demo video recorded.
- [ ] Submission URL checked in incognito.
- [ ] GitHub repository checked from a signed-out browser.
- [ ] Final submission copy checked.
- [ ] Claims say “prototype PassportAdapter” and “simulated verifier.”
- [ ] Derived Passport passes are described as a proposal pending Egoist validation.

## Freeze decision

- [ ] No blocking defect remains.
- [ ] Feature freeze confirmed: remaining work is deployment, copy, pitch, video, and judge preparation only.
