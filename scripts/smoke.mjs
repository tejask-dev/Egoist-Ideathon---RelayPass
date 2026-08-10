#!/usr/bin/env node

const COOKIE_NAME = "relaypass_demo_session";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const EXPECTED_DINNER_PATHS = [
  "calendar.required_arrival_time",
  "dietary.nut_free_required",
];
const RESTRICTED_SEED_SENTINELS = [
  "2028-02",
  "Tomorrow morning",
  "Card on file",
  "18 Sensitive Street",
  "+1 416 555 0100",
  "Maya Chen",
  "Private diagnosis",
  "Private medications",
  "Private contact",
  "Private host details",
  "private@example.test",
  "PRIVATE-ID",
  "PRIVATE-PASSPORT",
  "1990-01-01",
  "PRIVATE-BANK",
  "PRIVATE-ACCOUNT",
  "PRIVATE-PASSWORD",
  "PRIVATE-API-KEY",
  "PRIVATE-CODES",
  "Private client",
  "Private notes",
];
const COMPACT_JWS_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const PRIVATE_JWK_PATTERN = /"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/;

class SmokeFailure extends Error {
  constructor(step, message) {
    super(message);
    this.name = "SmokeFailure";
    this.step = step;
  }
}

function check(condition, step, message) {
  if (!condition) throw new SmokeFailure(step, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value].sort()
    : undefined;
}

function sameStrings(actual, expected) {
  const sorted = sortedStrings(actual);
  return Boolean(sorted && JSON.stringify(sorted) === JSON.stringify([...expected].sort()));
}

function parseTarget(rawTarget) {
  if (!rawTarget) {
    throw new SmokeFailure(
      "usage",
      "Run: npm run smoke -- https://your-relaypass-deployment.example",
    );
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new SmokeFailure("usage", "The deployment target must be an absolute URL.");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  check(
    target.protocol === "https:" ||
      (target.protocol === "http:" && localHosts.has(target.hostname)),
    "usage",
    "Use HTTPS for deployments; HTTP is accepted only for a local smoke test.",
  );
  check(
    !target.username &&
      !target.password &&
      !target.search &&
      !target.hash &&
      (target.pathname === "/" || target.pathname === ""),
    "usage",
    "Pass only the deployment origin, without credentials, path, query, or fragment.",
  );
  return new URL("/api/demo", target.origin);
}

async function readJson(response, step) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  check(bytes.byteLength <= MAX_RESPONSE_BYTES, step, "Response exceeded the smoke-test limit.");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SmokeFailure(step, "Response was not valid UTF-8 JSON.");
  }
}

function checkNoStore(response, step) {
  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  const pragma = response.headers.get("pragma")?.toLowerCase() ?? "";
  const vary = response.headers.get("vary")?.toLowerCase() ?? "";
  check(cacheControl.includes("private"), step, "API response was not private.");
  check(cacheControl.includes("no-store"), step, "API response was cacheable.");
  check(pragma.includes("no-cache"), step, "API response omitted Pragma: no-cache.");
  check(vary.split(",").some((value) => value.trim() === "cookie"), step, "API response did not vary on Cookie.");
}

function checkSecurityHeaders(response, step) {
  const csp = response.headers.get("content-security-policy") ?? "";
  check(csp.includes("default-src 'self'"), step, "Content-Security-Policy was missing.");
  check(csp.includes("frame-ancestors 'none'"), step, "CSP did not prevent framing.");
  check(response.headers.get("x-frame-options") === "DENY", step, "X-Frame-Options was not DENY.");
  check(
    response.headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
    step,
    "X-Content-Type-Options was not nosniff.",
  );
  check(
    response.headers.get("referrer-policy")?.toLowerCase() === "no-referrer",
    step,
    "Referrer-Policy was not no-referrer.",
  );
  check(!response.headers.has("x-powered-by"), step, "Framework disclosure header was present.");
}

function checkSnapshotEnvelope(snapshot, cookie, step) {
  check(isRecord(snapshot), step, "Snapshot was not an object.");
  check(snapshot.version === "relaypass-demo/1", step, "Snapshot version was unexpected.");
  check(Array.isArray(snapshot.receipts), step, "Snapshot receipts were missing.");
  check(isRecord(snapshot.outcomes), step, "Snapshot outcomes were missing.");
  check(isRecord(snapshot.revocation), step, "Snapshot revocation state was missing.");
  const serialized = JSON.stringify(snapshot);
  check(!serialized.includes(cookie), step, "Opaque session bearer was echoed in JSON.");
  for (const forbiddenKey of [
    "privateKey",
    "privateJwk",
    "signingSecret",
    "compactJws",
    "sessionId",
  ]) {
    check(!serialized.includes(`\"${forbiddenKey}\"`), step, `Snapshot exposed ${forbiddenKey}.`);
  }
  for (let index = 0; index < RESTRICTED_SEED_SENTINELS.length; index += 1) {
    check(
      !serialized.includes(RESTRICTED_SEED_SENTINELS[index]),
      step,
      `Snapshot exposed restricted seed sentinel ${index + 1}.`,
    );
  }
  check(!COMPACT_JWS_PATTERN.test(serialized), step, "Snapshot exposed a compact JWS.");
  check(!PRIVATE_JWK_PATTERN.test(serialized), step, "Snapshot exposed private JWK material.");
}

function checkRestrictedCatalog(snapshot, step) {
  const memories = snapshot.passport?.memories;
  check(Array.isArray(memories), step, "Passport metadata catalog was missing.");
  for (const path of ["profile.home_address", "health.diagnosis"]) {
    const memory = memories.find((candidate) => candidate?.path === path);
    check(memory, step, `Restricted field metadata ${path} was missing.`);
    check(
      !Object.prototype.hasOwnProperty.call(memory, "displayValue"),
      step,
      `Restricted field ${path} exposed a display value.`,
    );
  }
}

function relayNode(snapshot, id, step) {
  const node = snapshot.relayTree?.nodes?.find((candidate) => candidate?.id === id);
  check(node, step, `Relay Tree node ${id} was missing.`);
  return node;
}

function checkPristine(snapshot, step) {
  check(snapshot.stage === "passport", step, "Session did not initialize at the Passport stage.");
  check(snapshot.passport?.holder === "Maya", step, "Passport holder was not Maya.");
  check(snapshot.passport?.memoryCount === 42, step, "Passport count was not 42.");
  check(snapshot.relayTree?.visibleEquation === "42 → 7 → 5 / 3 / 2", step, "Relay Tree equation changed.");
  check(snapshot.receipts.length === 0, step, "New session contained receipts.");
  check(Object.keys(snapshot.outcomes).length === 0, step, "New session contained outcomes.");
  check(snapshot.revocation.rootRevoked === false, step, "New session was revoked.");
  check(!snapshot.lastError, step, "New session contained an error.");
  checkRestrictedCatalog(snapshot, step);
}

function checkReceiptIntegrity(snapshot, step) {
  check(snapshot.receipts.length === 8, step, "Expected eight causal receipts before revocation.");
  check(
    new Set(snapshot.receipts.map((receipt) => receipt.receiptId)).size === snapshot.receipts.length,
    step,
    "Receipt IDs were not unique.",
  );

  const home = snapshot.receipts.find(
    (receipt) =>
      receipt.event === "context_refused" &&
      receipt.requestedContext?.includes("profile.home_address"),
  );
  check(home?.decision === "refused", step, "Home-address receipt did not record refusal.");
  check(home?.disclosedContext?.length === 0, step, "Home-address receipt claimed disclosure.");

  const hotel = snapshot.receipts.find(
    (receipt) => receipt.event === "action_refused" && receipt.action?.name === "hotel.book",
  );
  check(hotel?.decision === "refused", step, "Hotel receipt did not record refusal.");

  const dinner = snapshot.receipts.find(
    (receipt) => receipt.event === "context_read" && receipt.agentName === "DinnerAgent",
  );
  check(dinner?.decision === "allowed", step, "Dinner receipt did not record a completed read.");
  check(
    sameStrings(dinner?.disclosedContext, EXPECTED_DINNER_PATHS),
    step,
    "Dinner receipt did not contain the exact minimum field set.",
  );

  const flight = snapshot.receipts.find(
    (receipt) => receipt.event === "action_allowed" && receipt.action?.name === "flight.book",
  );
  check(flight?.decision === "allowed", step, "Flight receipt did not record completed booking.");
}

class BrowserSession {
  constructor(endpoint, name) {
    this.endpoint = endpoint;
    this.name = name;
    this.cookie = undefined;
  }

  async get(step) {
    return this.request("GET", undefined, step);
  }

  async post(action, step) {
    return this.request("POST", { action }, step);
  }

  async request(method, body, step) {
    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": "RelayPass-Deployment-Smoke/1.0",
    });
    if (this.cookie) headers.set("Cookie", `${COOKIE_NAME}=${this.cookie}`);
    if (method === "POST") {
      headers.set("Content-Type", "application/json");
      headers.set("Origin", this.endpoint.origin);
    }

    let response;
    try {
      response = await fetch(this.endpoint, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new SmokeFailure(step, `${this.name} could not reach the deployment API.`);
    }

    check(response.status === 200, step, `${this.name} API returned HTTP ${response.status}.`);
    checkNoStore(response, step);
    checkSecurityHeaders(response, step);

    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookieMatch = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie);
    check(cookieMatch?.[1], step, `${this.name} response did not issue its session cookie.`);
    const nextCookie = cookieMatch[1];
    check(/^[A-Za-z0-9_-]{43}$/.test(nextCookie), step, "Session cookie was not a 256-bit opaque ID.");
    check(/;\s*HttpOnly(?:;|$)/i.test(setCookie), step, "Session cookie was not HttpOnly.");
    check(/;\s*SameSite=Lax(?:;|$)/i.test(setCookie), step, "Session cookie was not SameSite=Lax.");
    check(/;\s*Path=\/api\/demo(?:;|$)/i.test(setCookie), step, "Session cookie path was too broad.");
    check(/;\s*Max-Age=7200(?:;|$)/i.test(setCookie), step, "Session cookie lifetime was unexpected.");
    check(/;\s*Priority=high(?:;|$)/i.test(setCookie), step, "Session cookie priority was not high.");
    check(!/;\s*Domain=/i.test(setCookie), step, "Session cookie was not host-only.");
    if (this.endpoint.protocol === "https:") {
      check(/;\s*Secure(?:;|$)/i.test(setCookie), step, "Production session cookie was not Secure.");
      check(
        response.headers.get("strict-transport-security")?.includes("max-age="),
        step,
        "HTTPS response omitted Strict-Transport-Security.",
      );
    }
    if (this.cookie) {
      check(nextCookie === this.cookie, step, `${this.name} unexpectedly rotated an active session.`);
    }
    this.cookie = nextCookie;

    const snapshot = await readJson(response, step);
    checkSnapshotEnvelope(snapshot, this.cookie, step);
    return snapshot;
  }
}

async function checkShell(endpoint) {
  const step = "web security preflight";
  let response;
  try {
    response = await fetch(new URL("/", endpoint.origin), {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SmokeFailure(step, "Could not load the deployed application shell.");
  }
  check(response.status === 200, step, `Application shell returned HTTP ${response.status}.`);
  checkSecurityHeaders(response, step);
  const contentType = response.headers.get("content-type") ?? "";
  check(contentType.toLowerCase().includes("text/html"), step, "Application shell was not HTML.");
  await response.body?.cancel();
}

async function run() {
  const endpoint = parseTarget(process.argv[2]);
  await checkShell(endpoint);

  const judgeA = new BrowserSession(endpoint, "Judge A");
  const judgeB = new BrowserSession(endpoint, "Judge B");

  const initialA = await judgeA.get("1. new session initialization");
  checkPristine(initialA, "1. new session initialization");
  const initialB = await judgeB.get("17. second session initialization");
  checkPristine(initialB, "17. second session initialization");
  check(judgeA.cookie !== judgeB.cookie, "17. second session initialization", "Two sessions shared one bearer.");

  let snapshot = await judgeA.post("request_consent", "3. root consent request");
  check(snapshot.stage === "consent" && snapshot.consent?.requested, "3. root consent request", "Consent request did not open.");

  snapshot = await judgeA.post("approve", "3. root consent approval");
  check(snapshot.stage === "root_active" && snapshot.consent?.approved, "3. root consent approval", "Root consent was not approved.");
  check(snapshot.receipts.length === 1, "3. root consent approval", "Root issuance receipt was missing.");

  snapshot = await judgeA.post("derive", "4. child-pass derivation");
  check(snapshot.stage === "children_active", "4. child-pass derivation", "Children did not become active.");
  for (const [id, count] of [["flight", 5], ["stay", 3], ["dinner", 2]]) {
    const node = relayNode(snapshot, id, "4. child-pass derivation");
    check(node.visibleCount === count && node.status === "active", "4. child-pass derivation", `${id} scope was unexpected.`);
    check(node.technicalProof?.chainVerified === true, "4. child-pass derivation", `${id} chain was not verified.`);
  }
  check(snapshot.receipts.length === 4, "4. child-pass derivation", "Child derivation receipts were incomplete.");

  snapshot = await judgeA.post("verify_flight", "5. airline authorization");
  check(snapshot.outcomes.flight?.decision?.allowed === true, "5. airline authorization", "Flight was not authorized.");
  check(snapshot.outcomes.flight?.decision?.code === "allowed", "5. airline authorization", "Flight decision code changed.");
  check(snapshot.outcomes.flight?.sideEffectPerformed === true, "5. airline authorization", "Flight side effect did not complete.");
  check(snapshot.outcomes.flight?.booking?.amount === 612, "5. airline authorization", "Flight amount was not $612.");
  const activeFlightPassId = snapshot.outcomes.flight?.technicalProof?.passId;
  check(typeof activeFlightPassId === "string", "5. airline authorization", "Flight proof omitted its pass ID.");

  snapshot = await judgeA.post("forbidden_context", "6. home-address refusal");
  const address = snapshot.outcomes.homeAddress;
  check(address?.requestedPath === "profile.home_address", "6. home-address refusal", "Wrong context attack ran.");
  check(address?.decision?.allowed === false, "6. home-address refusal", "Home address was allowed.");
  check(address?.decision?.code === "unauthorized_context", "6. home-address refusal", "Home-address reason changed.");
  check(address?.sharedFields === 0, "7. no sensitive value response", "Home-address response shared a field.");
  check(address?.passportValueFetchCalled === false, "7. no sensitive value response", "Passport value lookup was called.");
  check(address?.decision?.disclosedContext?.length === 0, "7. no sensitive value response", "Decision disclosed context.");
  checkRestrictedCatalog(snapshot, "7. no sensitive value response");
  check(
    !relayNode(snapshot, "flight", "7. no sensitive value response").technicalProof?.contextPaths?.includes("profile.home_address"),
    "7. no sensitive value response",
    "Flight pass contained the home-address path.",
  );

  snapshot = await judgeA.post("over_budget_hotel", "8. hotel limit refusal");
  const hotel = snapshot.outcomes.hotel;
  check(hotel?.requestedAmount === 260 && hotel?.authorizedMaximum === 220, "8. hotel limit refusal", "Hotel limit fixture changed.");
  check(hotel?.decision?.code === "constraint_violation", "8. hotel limit refusal", "Hotel overage was not refused.");
  check(hotel?.purchaseMade === false, "8. hotel limit refusal", "Hotel refusal performed a purchase.");

  snapshot = await judgeA.post("dinner_disclosure", "9. dinner minimum disclosure");
  const dinner = snapshot.outcomes.dinner;
  check(dinner?.decision?.allowed === true, "9. dinner minimum disclosure", "Dinner disclosure was not allowed.");
  check(dinner?.requiredConstraint === true, "9. dinner minimum disclosure", "Nut-free constraint was missing.");
  check(
    sameStrings(Object.keys(dinner?.disclosedContext ?? {}), EXPECTED_DINNER_PATHS),
    "9. dinner minimum disclosure",
    "DinnerAgent received more or less than the two permitted fields.",
  );
  check(dinner?.disclosedContext?.["dietary.nut_free_required"] === true, "9. dinner minimum disclosure", "Nut-free value was not true.");
  check(dinner?.diagnosisInPass === false, "10. diagnosis inaccessible", "Diagnosis entered the DinnerAgent pass.");
  check(dinner?.diagnosisDisclosed === false, "10. diagnosis inaccessible", "Diagnosis was disclosed.");
  check(!("health.diagnosis" in (dinner?.disclosedContext ?? {})), "10. diagnosis inaccessible", "Dinner payload contained diagnosis.");
  check(
    !relayNode(snapshot, "dinner", "10. diagnosis inaccessible").technicalProof?.contextPaths?.includes("health.diagnosis"),
    "10. diagnosis inaccessible",
    "Dinner pass contained the diagnosis path.",
  );
  checkReceiptIntegrity(snapshot, "11. receipt integrity");

  for (const action of ["request_consent", "approve", "derive", "verify_flight"]) {
    await judgeB.post(action, `17. Judge B ${action}`);
  }
  const activeB = await judgeB.get("17. Judge B active before isolation attack");
  check(activeB.outcomes.flight?.decision?.allowed === true, "17. Judge B active before isolation attack", "Judge B flight was not active.");

  snapshot = await judgeA.post("revoke", "12. root revocation");
  check(snapshot.revocation.rootRevoked === true, "12. root revocation", "Root was not revoked.");
  check(relayNode(snapshot, "nova", "13. descendants invalid").status === "revoked", "13. descendants invalid", "Nova was not revoked.");
  for (const id of ["flight", "stay", "dinner"]) {
    check(relayNode(snapshot, id, "13. descendants invalid").status === "invalid", "13. descendants invalid", `${id} remained active.`);
  }

  snapshot = await judgeA.post("retry_revoked_flight", "14. revoked FlightAgent retry");
  const retry = snapshot.outcomes.revokedRetry;
  check(retry?.decision?.allowed === false, "14. revoked FlightAgent retry", "Revoked retry was allowed.");
  check(retry?.decision?.semanticStatus === 401, "14. revoked FlightAgent retry", "Revoked retry was not semantically 401.");
  check(retry?.decision?.code === "relay_pass_revoked", "14. revoked FlightAgent retry", "Revoked retry reason changed.");
  check(retry?.sideEffectPerformed === false, "14. revoked FlightAgent retry", "Revoked retry performed a side effect.");
  check(retry?.samePassId === true, "14. revoked FlightAgent retry", "Retry did not use the same pass.");
  check(retry?.technicalProof?.passId === activeFlightPassId, "14. revoked FlightAgent retry", "Retry pass ID changed.");
  check(snapshot.receipts.length === 10, "14. revoked FlightAgent retry", "Final causal receipt count was not 10.");

  const unaffectedB = await judgeB.get("17. Judge B after Judge A revocation");
  check(unaffectedB.revocation.rootRevoked === false, "17. Judge B after Judge A revocation", "Judge A revoked Judge B.");
  check(relayNode(unaffectedB, "flight", "17. Judge B after Judge A revocation").status === "active", "17. Judge B after Judge A revocation", "Judge B child became invalid.");

  snapshot = await judgeA.post("reset", "15. session reset");
  checkPristine(snapshot, "15. session reset");
  const staleReplay = await judgeA.post("retry_revoked_flight", "16. old-generation replay attempt");
  check(Boolean(staleReplay.lastError), "16. old-generation replay attempt", "Old-order action did not fail safely.");
  check(staleReplay.receipts.length === 0, "16. old-generation replay attempt", "Old-generation attempt created a receipt.");
  check(Object.keys(staleReplay.outcomes).length === 0, "16. old-generation replay attempt", "Old-generation outcome reappeared.");
  const afterReplay = await judgeA.get("16. old-generation state not persisted");
  checkPristine(afterReplay, "16. old-generation state not persisted");

  const continuingB = await judgeB.post("forbidden_context", "17. Judge B continues after Judge A reset");
  check(continuingB.outcomes.homeAddress?.decision?.code === "unauthorized_context", "17. Judge B continues after Judge A reset", "Judge B could not continue independently.");
  check(continuingB.revocation.rootRevoked === false, "17. Judge B continues after Judge A reset", "Judge B inherited Judge A reset/revocation.");

  console.log("RelayPass deployment smoke passed: 17/17 checks, 2 isolated sessions.");
  console.log(`Target: ${endpoint.origin}`);
}

run().catch((error) => {
  if (error instanceof SmokeFailure) {
    console.error(`RelayPass deployment smoke failed at ${error.step}: ${error.message}`);
  } else {
    console.error("RelayPass deployment smoke failed safely with an unexpected local harness error.");
  }
  process.exitCode = 1;
});
