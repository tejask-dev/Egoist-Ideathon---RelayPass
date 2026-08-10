import { randomBytes } from "node:crypto";

import { DemoSessionCoordinator } from "./demo-session-coordinator";
import {
  InMemoryDemoSessionRepository,
  type DemoSessionRepository,
} from "./demo-session-repository";
import { DeterministicDemoSignerProvider } from "./demo-signer-provider";
import { SupabaseDemoSessionRepository } from "./supabase-demo-session-repository";

export class DemoDeploymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoDeploymentConfigurationError";
  }
}

const localDevelopmentSecret = randomBytes(48).toString("base64url");
let coordinator: DemoSessionCoordinator | undefined;

function requiresDurableDeployment(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

type DemoStore = "memory" | "supabase";

function selectedStore(): DemoStore {
  const configuredStore = process.env.RELAYPASS_DEMO_STORE;
  const requireDurable = requiresDurableDeployment();

  if (configuredStore && configuredStore !== "memory" && configuredStore !== "supabase") {
    throw new DemoDeploymentConfigurationError(
      "RELAYPASS_DEMO_STORE must be either memory or supabase",
    );
  }
  if (configuredStore === "memory" && requireDurable) {
    throw new DemoDeploymentConfigurationError(
      "Process-local demo storage is disabled in production",
    );
  }

  return configuredStore === "supabase" || requireDurable ? "supabase" : "memory";
}

function createRepository(store: DemoStore): DemoSessionRepository {
  if (store === "supabase") {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      throw new DemoDeploymentConfigurationError(
        "Production demo sessions require SUPABASE_URL and SUPABASE_SECRET_KEY",
      );
    }
    return new SupabaseDemoSessionRepository({ url, secretKey });
  }

  return new InMemoryDemoSessionRepository();
}

function signingSecret(store: DemoStore): string {
  const configured = process.env.RELAYPASS_DEMO_SIGNING_SECRET;
  if (configured) {
    if (Buffer.byteLength(configured, "utf8") < 32) {
      throw new DemoDeploymentConfigurationError(
        "RELAYPASS_DEMO_SIGNING_SECRET must contain at least 32 bytes",
      );
    }
    return configured;
  }
  if (store === "supabase") {
    throw new DemoDeploymentConfigurationError(
      "Durable demo sessions require RELAYPASS_DEMO_SIGNING_SECRET",
    );
  }
  return localDevelopmentSecret;
}

/**
 * Caches immutable orchestration dependencies only. Browser state is always
 * addressed by its opaque session cookie and never lives in a global DemoRuntime.
 */
export function getDemoSessionCoordinator(): DemoSessionCoordinator {
  const store = selectedStore();
  coordinator ??= new DemoSessionCoordinator({
    repository: createRepository(store),
    signerProvider: new DeterministicDemoSignerProvider(signingSecret(store)),
  });
  return coordinator;
}
