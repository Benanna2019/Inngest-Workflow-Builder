/**
 * Inngest Workflow Executor
 *
 * This replaces the Vercel "use workflow" approach with Inngest's durable execution.
 * Each action node is wrapped in step.run() for automatic retries and observability.
 */

import {
  preValidateConditionExpression,
  validateConditionExpression,
} from "@/lib/condition-validator";
import { inngest } from "@/lib/inngest/client";
import {
  getActionLabel,
  getStepImporter,
  type StepModule,
} from "@/lib/step-registry";
import type { StepContext } from "@/lib/steps/step-handler";
import { logWorkflowCompleteDb } from "@/lib/workflow-logging";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";

type SystemActionImporter = {
  importer: () => Promise<StepModule>;
  stepFunction: string;
};

// System actions that don't have plugins
const SYSTEM_ACTIONS: Record<string, SystemActionImporter> = {
  "Database Query": {
    importer: () => import("@/lib/steps/database-query") as Promise<StepModule>,
    stepFunction: "databaseQueryStep",
  },
  "HTTP Request": {
    importer: () => import("@/lib/steps/http-request") as Promise<StepModule>,
    stepFunction: "httpRequestStep",
  },
  Condition: {
    importer: () => import("@/lib/steps/condition") as Promise<StepModule>,
    stepFunction: "conditionStep",
  },
};

type ExecutionResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

type NodeOutputs = Record<string, { label: string; data: unknown }>;

export type WorkflowExecutionInput = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerInput?: Record<string, unknown>;
  executionId?: string;
  workflowId?: string;
};

/**
 * Helper to replace template variables in conditions
 */
function replaceTemplateVariable(
  match: string,
  nodeId: string,
  rest: string,
  outputs: NodeOutputs,
  evalContext: Record<string, unknown>,
  varCounter: { value: number }
): string {
  const sanitizedNodeId = nodeId.replace(/[^a-zA-Z0-9]/g, "_");
  const output = outputs[sanitizedNodeId];

  if (!output) {
    return match;
  }

  const dotIndex = rest.indexOf(".");
  let value: unknown;

  if (dotIndex === -1) {
    value = output.data;
  } else if (output.data === null || output.data === undefined) {
    value = undefined;
  } else {
    const fieldPath = rest.substring(dotIndex + 1);
    const fields = fieldPath.split(".");
    let current: unknown = output.data;

    for (const field of fields) {
      if (current && typeof current === "object") {
        current = (current as Record<string, unknown>)[field];
      } else {
        value = undefined;
        break;
      }
    }
    if (value === undefined && current !== undefined) {
      value = current;
    }
  }

  const varName = `__v${varCounter.value}`;
  varCounter.value += 1;
  evalContext[varName] = value;
  return varName;
}

type ConditionEvalResult = {
  result: boolean;
  resolvedValues: Record<string, unknown>;
};

/**
 * Evaluate condition expression with template variable replacement
 */
function evaluateConditionExpression(
  conditionExpression: unknown,
  outputs: NodeOutputs
): ConditionEvalResult {
  if (typeof conditionExpression === "boolean") {
    return { result: conditionExpression, resolvedValues: {} };
  }

  if (typeof conditionExpression === "string") {
    const preValidation = preValidateConditionExpression(conditionExpression);
    if (!preValidation.valid) {
      return { result: false, resolvedValues: {} };
    }

    try {
      const evalContext: Record<string, unknown> = {};
      const resolvedValues: Record<string, unknown> = {};
      let transformedExpression = conditionExpression;
      const templatePattern = /\{\{@([^:]+):([^}]+)\}\}/g;
      const varCounter = { value: 0 };

      transformedExpression = transformedExpression.replace(
        templatePattern,
        (match, nodeId, rest) => {
          const varName = replaceTemplateVariable(
            match,
            nodeId,
            rest,
            outputs,
            evalContext,
            varCounter
          );
          resolvedValues[rest] = evalContext[varName];
          return varName;
        }
      );

      const validation = validateConditionExpression(transformedExpression);
      if (!validation.valid) {
        return { result: false, resolvedValues };
      }

      const varNames = Object.keys(evalContext);
      const varValues = Object.values(evalContext);

      const evalFunc = new Function(
        ...varNames,
        `return (${transformedExpression});`
      );
      const result = evalFunc(...varValues);
      return { result: Boolean(result), resolvedValues };
    } catch {
      return { result: false, resolvedValues: {} };
    }
  }

  return { result: Boolean(conditionExpression), resolvedValues: {} };
}

/**
 * Process template variables in config
 */
function processTemplates(
  config: Record<string, unknown>,
  outputs: NodeOutputs
): Record<string, unknown> {
  const processed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      let processedValue = value;
      const templatePattern = /\{\{@([^:]+):([^}]+)\}\}/g;
      processedValue = processedValue.replace(
        templatePattern,
        (match, nodeId, rest) => {
          const sanitizedNodeId = nodeId.replace(/[^a-zA-Z0-9]/g, "_");
          const output = outputs[sanitizedNodeId];
          if (!output) {
            return match;
          }

          const dotIndex = rest.indexOf(".");
          if (dotIndex === -1) {
            const data = output.data;
            if (data === null || data === undefined) {
              return "";
            }
            if (typeof data === "object") {
              return JSON.stringify(data);
            }
            return String(data);
          }

          if (output.data === null || output.data === undefined) {
            return "";
          }

          const fieldPath = rest.substring(dotIndex + 1);
          const fields = fieldPath.split(".");
          let current: unknown = output.data;

          for (const field of fields) {
            if (current && typeof current === "object") {
              current = (current as Record<string, unknown>)[field];
            } else {
              return "";
            }
          }

          if (current === null || current === undefined) {
            return "";
          }
          if (typeof current === "object") {
            return JSON.stringify(current);
          }
          return String(current);
        }
      );

      processed[key] = processedValue;
    } else {
      processed[key] = value;
    }
  }

  return processed;
}

/**
 * Get a meaningful node name
 */
function getNodeName(node: WorkflowNode): string {
  if (node.data.label) {
    return node.data.label;
  }
  if (node.data.type === "action") {
    const actionType = node.data.config?.actionType as string;
    if (actionType) {
      const label = getActionLabel(actionType);
      if (label) {
        return label;
      }
    }
    return "Action";
  }
  if (node.data.type === "trigger") {
    return (node.data.config?.triggerType as string) || "Trigger";
  }
  return node.data.type;
}

/**
 * Inngest Workflow Executor Function
 *
 * Executes a workflow with durable steps via Inngest.
 * Each action node is wrapped in step.run() for automatic retries.
 */
export const executeWorkflowFunction = inngest.createFunction(
  {
    id: "workflow-executor",
    name: "Execute Workflow",
    retries: 0, // We handle retries at the step level
  },
  { event: "workflow/execute" },
  async ({ event, step }) => {
    const {
      nodes,
      edges,
      triggerInput = {},
      executionId,
      workflowId,
    } = event.data as WorkflowExecutionInput;

    const outputs: NodeOutputs = {};
    const results: Record<string, ExecutionResult> = {};

    // Build node and edge maps
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edgesBySource = new Map<string, string[]>();
    for (const edge of edges) {
      const targets = edgesBySource.get(edge.source) || [];
      targets.push(edge.target);
      edgesBySource.set(edge.source, targets);
    }

    // Find trigger nodes
    const nodesWithIncoming = new Set(edges.map((e) => e.target));
    const triggerNodes = nodes.filter(
      (node) => node.data.type === "trigger" && !nodesWithIncoming.has(node.id)
    );

    // Helper to execute a single node
    async function executeNode(
      nodeId: string,
      visited: Set<string> = new Set()
    ) {
      if (visited.has(nodeId)) {
        return;
      }
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) {
        return;
      }

      // Skip disabled nodes
      if (node.data.enabled === false) {
        const sanitizedNodeId = nodeId.replace(/[^a-zA-Z0-9]/g, "_");
        outputs[sanitizedNodeId] = {
          label: node.data.label || nodeId,
          data: null,
        };

        const nextNodes = edgesBySource.get(nodeId) || [];
        for (const nextNodeId of nextNodes) {
          await executeNode(nextNodeId, visited);
        }
        return;
      }

      try {
        let result: ExecutionResult;

        if (node.data.type === "trigger") {
          // Execute trigger step
          result = await step.run(`trigger-${nodeId}`, async () => {
            const config = node.data.config || {};
            const triggerType = config.triggerType as string;
            let triggerData: Record<string, unknown> = {
              triggered: true,
              timestamp: Date.now(),
            };

            // Handle webhook mock request for test runs
            if (
              triggerType === "Webhook" &&
              config.webhookMockRequest &&
              (!triggerInput || Object.keys(triggerInput).length === 0)
            ) {
              try {
                const mockData = JSON.parse(
                  config.webhookMockRequest as string
                );
                triggerData = { ...triggerData, ...mockData };
              } catch {
                // Ignore parse errors
              }
            } else if (triggerInput && Object.keys(triggerInput).length > 0) {
              triggerData = { ...triggerData, ...triggerInput };
            }

            return {
              success: true,
              data: triggerData,
            };
          });
        } else if (node.data.type === "action") {
          const config = node.data.config || {};
          const actionType = config.actionType as string | undefined;

          if (!actionType) {
            result = {
              success: false,
              error: `Action node "${node.data.label || node.id}" has no action type configured`,
            };
            results[nodeId] = result;
            return;
          }

          // Process templates, keeping condition unprocessed
          const configWithoutCondition = { ...config };
          const originalCondition = config.condition;
          configWithoutCondition.condition = undefined;

          const processedConfig = processTemplates(
            configWithoutCondition,
            outputs
          );

          if (originalCondition !== undefined) {
            processedConfig.condition = originalCondition;
          }

          // Build step context
          const stepContext: StepContext = {
            executionId,
            nodeId: node.id,
            nodeName: getNodeName(node),
            nodeType: actionType,
          };

          // Execute action in a durable step
          const stepResult = await step.run(
            `action-${nodeId}-${actionType}`,
            async (): Promise<unknown> => {
              const stepInput: Record<string, unknown> = {
                ...processedConfig,
                _context: stepContext,
              };

              // Special handling for Condition action
              if (actionType === "Condition") {
                const systemAction = SYSTEM_ACTIONS.Condition;
                const module = (await systemAction.importer()) as Record<
                  string,
                  (input: unknown) => Promise<unknown>
                >;
                const originalExpression = stepInput.condition;
                const { result: evaluatedCondition, resolvedValues } =
                  evaluateConditionExpression(originalExpression, outputs);

                return await module[systemAction.stepFunction]({
                  condition: evaluatedCondition,
                  expression:
                    typeof originalExpression === "string"
                      ? originalExpression
                      : undefined,
                  values:
                    Object.keys(resolvedValues).length > 0
                      ? resolvedValues
                      : undefined,
                  _context: stepContext,
                });
              }

              // Check system actions first
              const systemAction = SYSTEM_ACTIONS[actionType];
              if (systemAction) {
                const module = (await systemAction.importer()) as Record<
                  string,
                  (input: unknown) => Promise<unknown>
                >;
                return await module[systemAction.stepFunction](stepInput);
              }

              // Look up plugin action from registry
              const stepImporter = getStepImporter(actionType);
              if (stepImporter) {
                const module = (await stepImporter.importer()) as Record<
                  string,
                  (input: unknown) => Promise<unknown>
                >;
                const stepFunction = module[stepImporter.stepFunction];
                if (stepFunction) {
                  return await stepFunction(stepInput);
                }

                return {
                  success: false,
                  error: `Step function "${stepImporter.stepFunction}" not found for action "${actionType}"`,
                };
              }

              return {
                success: false,
                error: `Unknown action type: "${actionType}"`,
              };
            }
          );

          // Check if the step returned an error result
          const isErrorResult =
            stepResult &&
            typeof stepResult === "object" &&
            "success" in stepResult &&
            (stepResult as { success: boolean }).success === false;

          if (isErrorResult) {
            const errorResult = stepResult as {
              success: false;
              error?: string;
            };
            result = {
              success: false,
              error: errorResult.error || `Step "${actionType}" failed`,
            };
          } else {
            result = {
              success: true,
              data: stepResult,
            };
          }
        } else {
          result = {
            success: false,
            error: `Unknown node type "${node.data.type}"`,
          };
        }

        // Store results
        results[nodeId] = result;

        const sanitizedNodeId = nodeId.replace(/[^a-zA-Z0-9]/g, "_");
        outputs[sanitizedNodeId] = {
          label: node.data.label || nodeId,
          data: result.data,
        };

        // Execute next nodes if successful
        if (result.success) {
          const isConditionNode =
            node.data.type === "action" &&
            node.data.config?.actionType === "Condition";

          if (isConditionNode) {
            const conditionResult = (result.data as { condition?: boolean })
              ?.condition;

            if (conditionResult === true) {
              const nextNodes = edgesBySource.get(nodeId) || [];
              for (const nextNodeId of nextNodes) {
                await executeNode(nextNodeId, visited);
              }
            }
          } else {
            const nextNodes = edgesBySource.get(nodeId) || [];
            for (const nextNodeId of nextNodes) {
              await executeNode(nextNodeId, visited);
            }
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results[nodeId] = {
          success: false,
          error: errorMessage,
        };
      }
    }

    // Execute from each trigger node
    const workflowStartTime = Date.now();

    for (const trigger of triggerNodes) {
      await executeNode(trigger.id);
    }

    const finalSuccess = Object.values(results).every((r) => r.success);
    const duration = Date.now() - workflowStartTime;

    // Update execution record if we have an executionId
    if (executionId) {
      console.log("[Inngest Executor] Updating execution status:", {
        executionId,
        finalSuccess,
        resultsCount: Object.keys(results).length,
      });
      await step.run("update-execution-status", async () => {
        console.log("[Inngest Executor] Running logWorkflowCompleteDb");
        await logWorkflowCompleteDb({
          executionId,
          status: finalSuccess ? "success" : "error",
          output: Object.values(results).at(-1)?.data,
          error: Object.values(results).find((r) => !r.success)?.error,
          startTime: workflowStartTime,
        });
        console.log("[Inngest Executor] logWorkflowCompleteDb completed");
      });
    } else {
      console.log(
        "[Inngest Executor] No executionId provided, skipping status update"
      );
    }

    return {
      success: finalSuccess,
      results,
      outputs,
      duration,
      workflowId,
      executionId,
    };
  }
);
