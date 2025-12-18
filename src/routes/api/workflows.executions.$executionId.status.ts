import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowExecutionLogs, workflowExecutions } from "@/lib/db/schema";

export const Route = createFileRoute(
  "/api/workflows/executions/$executionId/status"
)({
  server: {
    handlers: {
      GET: getExecutionStatusByExecutionId,
    },
  },
});

type NodeStatus = {
  nodeId: string;
  status: "pending" | "running" | "success" | "error";
};

export async function getExecutionStatusByExecutionId({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { executionId } = await params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    // Get the execution and verify ownership
    const execution = await db.query.workflowExecutions.findFirst({
      where: eq(workflowExecutions.id, executionId),
      with: {
        workflow: true,
      },
    });

    if (!execution) {
      return new Response(
        JSON.stringify({ error: "Execution not found", status: 404 })
      );
    }

    // Verify the workflow belongs to the user
    if (execution.workflow.userId !== session.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden", status: 403 }));
    }

    // Get logs for all nodes
    const logs = await db.query.workflowExecutionLogs.findMany({
      where: eq(workflowExecutionLogs.executionId, executionId),
    });

    // Map logs to node statuses
    const nodeStatuses: NodeStatus[] = logs.map((log) => ({
      nodeId: log.nodeId,
      status: log.status,
    }));

    return new Response(
      JSON.stringify({
        status: execution.status,
        nodeStatuses,
      })
    );
  } catch (error) {
    console.error("Failed to get execution status:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to get execution status",
        status: 500,
      })
    );
  }
}
