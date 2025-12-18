import { Inngest } from "inngest";

/**
 * Inngest client for the workflow builder
 *
 * This client is used to create and invoke Inngest functions
 * for workflow plugin steps.
 */
export const inngest = new Inngest({
  id: "workflow-builder",
  eventKey: "dummy-key",
});
