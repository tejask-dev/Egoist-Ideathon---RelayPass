import { z } from "zod";

import { DEMO_ACTIONS } from "./types";

/**
 * The browser may select a fixed demo transition, but it cannot submit policy,
 * context paths, action arguments, or limits for the runtime to trust.
 */
export const DemoActionBodySchema = z
  .object({
    action: z.enum(DEMO_ACTIONS),
  })
  .strict();

export type DemoActionBody = z.infer<typeof DemoActionBodySchema>;
