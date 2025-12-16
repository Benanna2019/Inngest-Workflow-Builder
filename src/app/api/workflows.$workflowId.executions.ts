import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  workflowExecutionLogs,
  workflowExecutions,
  workflows,
} from "@/lib/db/schema";

export const Route = createFileRoute("/api/workflows/$workflowId/executions")({
  server: {
    handlers: {
      GET: getWorkflowExecutions,
      DELETE: removeWorkflowExecutions,
    },
  },
});

async function getWorkflowExecutions({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { workflowId } = await params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    // Verify workflow ownership
    const workflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, session.user.id)
      ),
    });

    if (!workflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    // Fetch executions
    const executions = await db.query.workflowExecutions.findMany({
      where: eq(workflowExecutions.workflowId, workflowId),
      orderBy: [desc(workflowExecutions.startedAt)],
      limit: 50,
    });

    return new Response(JSON.stringify(executions));
  } catch (error) {
    console.error("Failed to get executions:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to get executions",
        status: 500,
      })
    );
  }
}

async function removeWorkflowExecutions({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { workflowId } = await params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    // Verify workflow ownership
    const workflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, session.user.id)
      ),
    });

    if (!workflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    // Get all execution IDs for this workflow
    const executions = await db.query.workflowExecutions.findMany({
      where: eq(workflowExecutions.workflowId, workflowId),
      columns: { id: true },
    });

    const executionIds = executions.map((e) => e.id);

    // Delete logs first (if there are any executions)
    if (executionIds.length > 0) {
      await db
        .delete(workflowExecutionLogs)
        .where(inArray(workflowExecutionLogs.executionId, executionIds));

      // Then delete the executions
      await db
        .delete(workflowExecutions)
        .where(eq(workflowExecutions.workflowId, workflowId));
    }

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount: executionIds.length,
      })
    );
  } catch (error) {
    console.error("Failed to delete executions:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete executions",
        status: 500,
      })
    );
  }
}
