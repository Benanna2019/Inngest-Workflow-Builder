/**
 * Inngest Functions Registry
 *
 * This file exports all Inngest functions for the workflow builder.
 */

// Workflow Executor - the main function that runs workflows
export { executeWorkflowFunction } from "./workflow-executor";

// Export all functions as an array for the serve handler
import { executeWorkflowFunction } from "./workflow-executor";

export const allFunctions = [executeWorkflowFunction];
