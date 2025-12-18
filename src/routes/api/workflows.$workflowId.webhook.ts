import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { validateWorkflowIntegrations } from "@/lib/db/integrations";
import { apiKeys, workflowExecutions, workflows } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";

export const Route = createFileRoute("/api/workflows/$workflowId/webhook")({
  server: {
    handlers: {
      OPTIONS: optionsAndIDontKnowWhatThisDoes,
      POST: webhookPostEndpoint,
    },
  },
});

// Validate API key and return the user ID if valid
async function validateApiKey(
  authHeader: string | null,
  workflowUserId: string
): Promise<{ valid: boolean; error?: string; statusCode?: number }> {
  if (!authHeader) {
    return {
      valid: false,
      error: "Missing Authorization header",
      statusCode: 401,
    };
  }

  // Support "Bearer <key>" format
  const key = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!key?.startsWith("wfb_")) {
    return { valid: false, error: "Invalid API key format", statusCode: 401 };
  }

  // Hash the key to compare with stored hash
  const keyHash = createHash("sha256").update(key).digest("hex");

  // Find the API key in the database
  const apiKey = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
  });

  if (!apiKey) {
    return { valid: false, error: "Invalid API key", statusCode: 401 };
  }

  // Verify the API key belongs to the workflow owner
  if (apiKey.userId !== workflowUserId) {
    return {
      valid: false,
      error: "You do not have permission to run this workflow",
      statusCode: 403,
    };
  }

  // Update last used timestamp (don't await, fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id))
    .catch(() => {
      // Fire and forget - ignore errors
    });

  return { valid: true };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// biome-ignore lint/nursery/useMaxParams: Background execution requires all workflow context
async function executeWorkflowBackground(
  executionId: string,
  workflowId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  input: Record<string, unknown>
) {
  try {
    console.log("[Webhook] Starting execution:", executionId);
    console.log("[Webhook] Sending to Inngest with:", {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      hasExecutionId: !!executionId,
      workflowId,
    });

    // Send event to Inngest to execute the workflow
    await inngest.send({
      name: "workflow/execute",
      data: {
        nodes,
        edges,
        triggerInput: input,
        executionId,
        workflowId,
      },
    });

    console.log("[Webhook] Workflow event sent to Inngest");
  } catch (error) {
    console.error("[Webhook] Error sending to Inngest:", error);
    console.error(
      "[Webhook] Error stack:",
      error instanceof Error ? error.stack : "N/A"
    );

    await db
      .update(workflowExecutions)
      .set({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, executionId));
  }
}

function optionsAndIDontKnowWhatThisDoes() {
  return new Response(JSON.stringify({}), { headers: corsHeaders });
}

async function webhookPostEndpoint({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { workflowId } = await params;

    // Get workflow
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 }),
        { headers: corsHeaders }
      );
    }

    // Validate API key - must belong to the workflow owner
    const authHeader = request.headers.get("Authorization");
    const apiKeyValidation = await validateApiKey(authHeader, workflow.userId);

    if (!apiKeyValidation.valid) {
      return new Response(
        JSON.stringify({
          error: apiKeyValidation.error,
          status: apiKeyValidation.statusCode || 401,
        }),
        { headers: corsHeaders }
      );
    }

    // Verify this is a webhook-triggered workflow
    const triggerNode = (workflow.nodes as WorkflowNode[]).find(
      (node) => node.data.type === "trigger"
    );

    if (!triggerNode || triggerNode.data.config?.triggerType !== "Webhook") {
      return new Response(
        JSON.stringify({
          error: "This workflow is not configured for webhook triggers",
          status: 400,
        }),
        { headers: corsHeaders }
      );
    }

    // Validate that all integrationIds in workflow nodes belong to the workflow owner
    const validation = await validateWorkflowIntegrations(
      workflow.nodes as WorkflowNode[],
      workflow.userId
    );
    if (!validation.valid) {
      console.error(
        "[Webhook] Invalid integration references:",
        validation.invalidIds
      );
      return new Response(
        JSON.stringify({
          error: "Workflow contains invalid integration references",
          status: 403,
        }),
        { headers: corsHeaders }
      );
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));

    // Create execution record
    const [execution] = await db
      .insert(workflowExecutions)
      .values({
        workflowId,
        userId: workflow.userId,
        status: "running",
        input: body,
      })
      .returning();

    console.log("[Webhook] Created execution:", execution.id);

    // Execute the workflow in the background (don't await)
    executeWorkflowBackground(
      execution.id,
      workflowId,
      workflow.nodes as WorkflowNode[],
      workflow.edges as WorkflowEdge[],
      body
    );

    // Return immediately with the execution ID
    return new Response(
      JSON.stringify({
        executionId: execution.id,
        status: "running",
      }),
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[Webhook] Failed to start workflow execution:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to execute workflow",
        status: 500,
      }),
      { headers: corsHeaders }
    );
  }
}
