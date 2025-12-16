import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { generateWorkflowSDKCode } from "@/lib/workflow-codegen-sdk";

export const Route = createFileRoute("/api/workflows/$workflowId/code")({
  server: {
    handlers: {
      GET: getWorkflowCode,
    },
  },
});

async function getWorkflowCode({
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

    // Generate code
    const code = generateWorkflowSDKCode(
      workflow.name,
      workflow.nodes,
      workflow.edges
    );

    return new Response(
      JSON.stringify({
        code,
        workflowName: workflow.name,
      })
    );
  } catch (error) {
    console.error("Failed to get workflow code:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to get workflow code",
        status: 500,
      })
    );
  }
}
