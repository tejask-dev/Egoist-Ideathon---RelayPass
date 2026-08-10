import { beforeAll, describe, expect, it } from "vitest";

import {
  AttenuationEngine,
  AttenuationError,
  RootPassIssuer,
  type ChildPassRequest,
} from "../index";
import {
  CHILD_VALID_UNTIL,
  NEVER_DISCLOSE,
  PROHIBITED_ACTIONS,
  ROOT_CONTEXT,
  ROOT_VALID_UNTIL,
  STEP_UP_REQUIRED,
  clone,
  generateTestSigners,
  issueRoot,
  makeRootConsent,
  makeStayRequest,
  type TestSigners,
} from "./fixtures";

describe("AttenuationEngine", () => {
  let signers: TestSigners;

  beforeAll(async () => {
    signers = await generateTestSigners();
  });

  async function derive(request: ChildPassRequest = makeStayRequest(signers)) {
    const root = await issueRoot(signers);
    const child = await new AttenuationEngine(() => "rp_unused_deterministic").derive(
      root,
      request,
      signers.nova,
    );
    return { root, child };
  }

  async function expectInvalidDerivation(
    request: ChildPassRequest,
    expectedIssue: string,
  ) {
    const root = await issueRoot(signers);

    await expect(
      new AttenuationEngine(() => "rp_rejected_derivation").derive(
        root,
        request,
        signers.nova,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "AttenuationError",
        code: "invalid_derivation",
        details: expect.arrayContaining([expectedIssue]),
      }),
    );
  }

  it("passes when a child removes context", async () => {
    const { root, child } = await derive();

    expect(root.context.read).toEqual(ROOT_CONTEXT);
    expect(child.context.read).toEqual(["travel.destination", "trip.event_area"]);
    expect(child.context.read.length).toBeLessThan(root.context.read.length);
    expect(child.context.read.every((path) => root.context.read.includes(path))).toBe(true);
  });

  it("generates the child ID internally and inherits the parent holder binding", async () => {
    const { root, child } = await derive();

    expect(child.passId).toBe("rp_unused_deterministic");
    expect(child.holder).toEqual(root.holder);
    expect(child.holder.pairwiseId).toBe("maya_pairwise_trip_2026");
  });

  it("passes when a child lowers its spending limit", async () => {
    const { root, child } = await derive();
    const rootAmount = root.authority.allowedActions.find(
      ({ action }) => action === "hotel.book",
    )?.constraints.amount;
    const childAmount = child.authority.allowedActions.find(
      ({ action }) => action === "hotel.book",
    )?.constraints.amount;

    expect(rootAmount).toEqual({ kind: "max", value: 500 });
    expect(childAmount).toEqual({ kind: "max", value: 220 });
  });

  it("passes when a child shortens expiry", async () => {
    const { root, child } = await derive();

    expect(root.lifecycle.validUntil).toBe(ROOT_VALID_UNTIL);
    expect(child.lifecycle.validUntil).toBe(CHILD_VALID_UNTIL);
    expect(Date.parse(child.lifecycle.validUntil)).toBeLessThan(
      Date.parse(root.lifecycle.validUntil),
    );
  });

  it("passes when a child removes an action", async () => {
    const { root, child } = await derive();

    expect(root.authority.allowedActions.map(({ action }) => action)).toEqual([
      "flight.book",
      "hotel.book",
    ]);
    expect(child.authority.allowedActions.map(({ action }) => action)).toEqual([
      "hotel.book",
    ]);
  });

  it("passes when a child narrows audience and structured purpose scopes", async () => {
    const { root, child } = await derive();

    expect(child.audience.allowedAgents).toEqual(["agent-hotel-scout"]);
    expect(child.audience.allowedServices).toEqual(["service-hotel"]);
    expect(child.audience.allowedAgents.every((id) =>
      root.audience.allowedAgents.includes(id),
    )).toBe(true);
    expect(child.audience.allowedServices.every((id) =>
      root.audience.allowedServices.includes(id),
    )).toBe(true);
    expect(child.purpose.scopes).toEqual(["travel.book"]);
    expect(child.purpose.scopes.every((scope) =>
      root.purpose.scopes.includes(scope),
    )).toBe(true);
  });

  it("fails when a child adds context unavailable to its parent", async () => {
    const request = clone(makeStayRequest(signers));
    request.context.read.push("travel.passport_number");

    await expectInvalidDerivation(request, "context read set expanded");
  });

  it("fails when a child increases a spending limit", async () => {
    const request = clone(makeStayRequest(signers));
    const hotel = request.authority.allowedActions.find(
      ({ action }) => action === "hotel.book",
    );
    if (!hotel) throw new Error("Fixture is missing hotel.book");
    hotel.constraints.amount = { kind: "max", value: 501 };

    await expectInvalidDerivation(
      request,
      "action hotel.book broadens constraint amount",
    );
  });

  it("fails when a child extends expiry", async () => {
    const request = clone(makeStayRequest(signers));
    request.lifecycle.validUntil = "2026-08-10T12:00:00.001Z";

    await expectInvalidDerivation(request, "expiry extends beyond parent");
  });

  it("fails when a child starts validity before its parent", async () => {
    const request = clone(makeStayRequest(signers));
    request.lifecycle.validFrom = "2026-08-09T11:59:59.999Z";

    await expectInvalidDerivation(request, "validity starts before parent");
  });

  it("fails when a child adds an action", async () => {
    const request = clone(makeStayRequest(signers));
    request.authority.allowedActions.push({
      action: "car.book",
      targets: ["car.simulated"],
      constraints: {
        amount: { kind: "max", value: 100 },
      },
      requiresHumanApproval: false,
    });

    await expectInvalidDerivation(request, "new action added: car.book");
  });

  it("fails when a child adds a target to an inherited action", async () => {
    const request = clone(makeStayRequest(signers));
    const hotel = request.authority.allowedActions.find(
      ({ action }) => action === "hotel.book",
    );
    if (!hotel) throw new Error("Fixture is missing hotel.book");
    hotel.targets.push("hotel.unapproved");

    await expectInvalidDerivation(
      request,
      "action hotel.book expands target resources",
    );
  });

  it("fails when a child removes an inherited action constraint", async () => {
    const request = clone(makeStayRequest(signers));
    const hotel = request.authority.allowedActions.find(
      ({ action }) => action === "hotel.book",
    );
    if (!hotel) throw new Error("Fixture is missing hotel.book");
    delete hotel.constraints.currency;

    await expectInvalidDerivation(
      request,
      "action hotel.book removes constraint currency",
    );
  });

  it("fails when a child adds a new action argument vocabulary", async () => {
    const request = clone(makeStayRequest(signers));
    const hotel = request.authority.allowedActions.find(
      ({ action }) => action === "hotel.book",
    );
    if (!hotel) throw new Error("Fixture is missing hotel.book");
    hotel.constraints.vip = { kind: "exact", value: true };

    await expectInvalidDerivation(request, "action hotel.book adds argument vip");
  });

  it("fails when a child removes inherited human approval", async () => {
    const consent = makeRootConsent(signers);
    const hotel = consent.authority.allowedActions.find(
      ({ action }) => action === "hotel.book",
    );
    if (!hotel) throw new Error("Fixture is missing hotel.book");
    hotel.requiresHumanApproval = true;
    const root = await new RootPassIssuer(
      signers.rootIssuer,
      () => "rp_root_human_approval",
    ).issue(consent);

    await expect(
      new AttenuationEngine(() => "rp_rejected_human_approval").derive(
        root,
        makeStayRequest(signers),
        signers.nova,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_derivation",
        details: expect.arrayContaining([
          "action hotel.book removes required human approval",
        ]),
      }),
    );
  });

  it("fails when a child broadens its service audience", async () => {
    const request = clone(makeStayRequest(signers));
    request.audience.allowedServices.push("service-unapproved-car-rental");

    await expectInvalidDerivation(request, "service audience expanded");
  });

  it("fails when a child broadens structured purpose", async () => {
    const request = clone(makeStayRequest(signers));
    request.purpose.scopes.push("payments.transfer");

    await expectInvalidDerivation(request, "purpose scope expanded");
  });

  it("fails when a child increases the delegation ceiling", async () => {
    const request = clone(makeStayRequest(signers));
    request.delegation.maxDepth = 4;

    await expectInvalidDerivation(request, "maximum delegation depth increased");
  });

  it("allows a child to preserve inherited restrictions and add stricter ones", async () => {
    const request = clone(makeStayRequest(signers));
    request.context.neverDisclose.push("profile.phone_number");
    request.context.stepUpRequired.push("profile.legal_name");
    request.authority.prohibitedActions.push("calendar.delete");

    const { child } = await derive(request);

    expect(child.context.neverDisclose).toEqual([
      ...NEVER_DISCLOSE,
      "profile.phone_number",
    ]);
    expect(child.context.stepUpRequired).toEqual([
      ...STEP_UP_REQUIRED,
      "profile.legal_name",
    ]);
    expect(child.authority.prohibitedActions).toEqual([
      ...PROHIBITED_ACTIONS,
      "calendar.delete",
    ]);
  });

  it("fails when a child removes an inherited never-disclose restriction", async () => {
    const request = clone(makeStayRequest(signers));
    request.context.neverDisclose = request.context.neverDisclose.slice(1);

    await expectInvalidDerivation(
      request,
      "inherited never-disclose field was removed",
    );
  });

  it("fails when a child removes an inherited step-up restriction", async () => {
    const request = clone(makeStayRequest(signers));
    request.context.stepUpRequired = [];

    await expectInvalidDerivation(
      request,
      "inherited step-up requirement was removed",
    );
  });

  it("fails when a child removes an inherited prohibited action", async () => {
    const request = clone(makeStayRequest(signers));
    request.authority.prohibitedActions = request.authority.prohibitedActions.slice(1);

    await expectInvalidDerivation(
      request,
      "inherited prohibited action was removed",
    );
  });

  it("surfaces typed attenuation errors", async () => {
    const request = clone(makeStayRequest(signers));
    request.context.read.push("travel.loyalty_number");
    const root = await issueRoot(signers);

    await expect(
      new AttenuationEngine(() => "rp_rejected_typed_error").derive(
        root,
        request,
        signers.nova,
      ),
    ).rejects.toBeInstanceOf(AttenuationError);
  });
});
