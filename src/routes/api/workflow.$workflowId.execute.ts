import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateWorkflowIntegrations } from "@/lib/db/integrations";
import { workflowExecutions, workflows } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";

export const Route = createFileRoute("/api/workflow/$workflowId/execute")({
  server: {
    handlers: {
      POST: runWorkflow,
    },
  },
});

// biome-ignore lint/nursery/useMaxParams: Background execution requires all workflow context
async function executeWorkflowBackground(
  executionId: string,
  workflowId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  input: Record<string, unknown>
) {
  try {
    console.log("[Workflow Execute] Starting execution:", executionId);
    console.log("[Workflow Execute] Sending to Inngest with:", {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      hasExecutionId: !!executionId,
      workflowId,
    });

    // Send event to Inngest to execute the workflow
    // SECURITY: We pass only the workflowId as a reference
    // Steps will fetch credentials internally using fetchCredentials(integrationId)
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

    console.log("[Workflow Execute] Workflow event sent to Inngest");
  } catch (error) {
    console.error("[Workflow Execute] Error sending to Inngest:", error);
    console.error(
      "[Workflow Execute] Error stack:",
      error instanceof Error ? error.stack : "N/A"
    );

    // Update execution record with error
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

async function runWorkflow({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { workflowId } = await params;

    // Get session
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    // Get workflow and verify ownership
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    if (workflow.userId !== session.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden", status: 403 }));
    }

    // Validate that all integrationIds in workflow nodes belong to the current user
    const validation = await validateWorkflowIntegrations(
      workflow.nodes as WorkflowNode[],
      session.user.id
    );
    if (!validation.valid) {
      console.error(
        "[Workflow Execute] Invalid integration references:",
        validation.invalidIds
      );
      return new Response(
        JSON.stringify({
          error: "Workflow contains invalid integration references",
          status: 403,
        })
      );
    }

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const input = body.input || {};

    // Create execution record
    const [execution] = await db
      .insert(workflowExecutions)
      .values({
        workflowId,
        userId: session.user.id,
        status: "running",
        input,
      })
      .returning();

    console.log("[API] Created execution:", execution.id);

    // Execute the workflow in the background (don't await)
    executeWorkflowBackground(
      execution.id,
      workflowId,
      workflow.nodes as WorkflowNode[],
      workflow.edges as WorkflowEdge[],
      input
    );

    // Return immediately with the execution ID
    return new Response(
      JSON.stringify({
        executionId: execution.id,
        status: "running",
      })
    );
  } catch (error) {
    console.error("Failed to start workflow execution:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to execute workflow",
        status: 500,
      })
    );
  }
}
