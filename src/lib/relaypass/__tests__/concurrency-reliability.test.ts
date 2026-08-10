import { beforeAll, describe, expect, it, vi } from "vitest";

import { ActionExecutionService } from "../action-execution-service";
import { ContextDisclosureService } from "../context-disclosure-service";
import { InMemoryPassportAdapter } from "../passport-adapter";
import {
  NOW,
  ROOT_CONSENT_ID,
  createPolicyHarness,
  generateTestSigners,
  issueFlightChain,
  signRequest,
  type TestSigners,
} from "./fixtures";

describe("RelayPass concurrent replay and one-use grants", () => {
  let signers: TestSigners;

  beforeAll(async () => {
    signers = await generateTestSigners();
  });

  it("allows exactly one of several concurrent copies of an action request", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, actionConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const service = new ActionExecutionService(evaluator, actionConsumer, receipts);
    const execute = vi.fn(async () => ({ bookingId: "one-booking-only" }));
    const request = await signRequest(signers.flight, {
      requestId: "request_concurrent_flight_booking",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: { amount: 600, currency: "USD" },
      },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.authorizeAndExecute(chain, request, execute),
      ),
    );

    expect(results.filter(({ decision }) => decision.code === "allowed")).toHaveLength(1);
    expect(
      results.filter(({ decision }) => decision.code === "request_replayed"),
    ).toHaveLength(7);
    expect(execute).toHaveBeenCalledOnce();
    const recorded = await receipts.listByRoot(ROOT_CONSENT_ID);
    expect(recorded.filter(({ event }) => event === "action_allowed")).toHaveLength(1);
    expect(
      recorded.filter(
        ({ event, reason }) =>
          event === "action_refused" && reason === "request_replayed",
      ),
    ).toHaveLength(7);
  });

  it("allows exactly one disclosure for concurrent copies of a context request", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, receipts } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const passport = new InMemoryPassportAdapter(
      flight.holder.pairwiseId,
      [
        {
          path: "travel.destination",
          value: "San Francisco",
          sensitivity: "standard",
        },
      ],
      contextConsumer,
      () => new Date(NOW),
    );
    const release = vi.spyOn(passport, "releaseAuthorizedContext");
    const disclosure = new ContextDisclosureService(evaluator, passport, receipts);
    const request = await signRequest(signers.flight, {
      requestId: "request_concurrent_destination",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        disclosure.authorizeAndRelease(chain, request),
      ),
    );

    expect(results.filter(({ decision }) => decision.code === "allowed")).toHaveLength(1);
    expect(
      results.filter(({ decision }) => decision.code === "request_replayed"),
    ).toHaveLength(7);
    expect(release).toHaveBeenCalledOnce();
    expect(results.find(({ decision }) => decision.allowed)?.context).toEqual({
      "travel.destination": "San Francisco",
    });
    const recorded = await receipts.listByRoot(ROOT_CONSENT_ID);
    expect(recorded.filter(({ event }) => event === "context_read")).toHaveLength(1);
  });

  it("consumes context and action grants exactly once under contention", async () => {
    const { chain, flight } = await issueFlightChain(signers);
    const { evaluator, contextConsumer, actionConsumer } = createPolicyHarness(
      signers,
      "service-airline",
    );
    const contextRequest = await signRequest(signers.flight, {
      requestId: "request_concurrent_context_grant",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: ["travel.destination"],
    });
    const actionRequest = await signRequest(signers.flight, {
      requestId: "request_concurrent_action_grant",
      passId: flight.passId,
      serviceId: "service-airline",
      requestedContext: [],
      action: {
        name: "flight.book",
        target: "airline.simulated",
        arguments: { amount: 600, currency: "USD" },
      },
    });
    const [contextEvaluation, actionEvaluation] = await Promise.all([
      evaluator.evaluate(chain, contextRequest),
      evaluator.evaluate(chain, actionRequest),
    ]);
    if (!contextEvaluation.contextGrant || !actionEvaluation.actionGrant) {
      throw new Error("Allowed evaluations did not create both one-use grants");
    }

    const [contextAttempts, actionAttempts] = await Promise.all([
      Promise.allSettled(
        Array.from({ length: 8 }, () =>
          contextConsumer.consume(contextEvaluation.contextGrant!, new Date(NOW)),
        ),
      ),
      Promise.allSettled(
        Array.from({ length: 8 }, () =>
          actionConsumer.consume(actionEvaluation.actionGrant!),
        ),
      ),
    ]);

    expect(contextAttempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(contextAttempts.filter(({ status }) => status === "rejected")).toHaveLength(7);
    expect(actionAttempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(actionAttempts.filter(({ status }) => status === "rejected")).toHaveLength(7);
  });
});
