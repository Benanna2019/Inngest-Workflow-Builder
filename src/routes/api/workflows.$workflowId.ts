import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateWorkflowIntegrations } from "@/lib/db/integrations";
import { workflows } from "@/lib/db/schema";

export const Route = createFileRoute("/api/workflows/$workflowId")({
  server: {
    handlers: {
      GET: getWorkflowById,
      PATCH: updateWorkflow,
      DELETE: deleteWorkflow,
    },
  },
});

// Helper to strip sensitive data from nodes for public viewing
function sanitizeNodesForPublicView(
  nodes: Record<string, unknown>[]
): Record<string, unknown>[] {
  return nodes.map((node) => {
    const sanitizedNode = { ...node };
    if (
      sanitizedNode.data &&
      typeof sanitizedNode.data === "object" &&
      sanitizedNode.data !== null
    ) {
      const data = { ...(sanitizedNode.data as Record<string, unknown>) };
      // Remove integrationId from config to not expose which integrations are used
      if (
        data.config &&
        typeof data.config === "object" &&
        data.config !== null
      ) {
        const { integrationId: _, ...configWithoutIntegration } =
          data.config as Record<string, unknown>;
        data.config = configWithoutIntegration;
      }
      sanitizedNode.data = data;
    }
    return sanitizedNode;
  });
}

async function getWorkflowById({
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

    // First, try to find the workflow
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    const isOwner = session?.user?.id === workflow.userId;

    // If not owner, check if workflow is public
    if (!isOwner && workflow.visibility !== "public") {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    // For public workflows viewed by non-owners, sanitize sensitive data
    const responseData = {
      ...workflow,
      nodes: isOwner
        ? workflow.nodes
        : sanitizeNodesForPublicView(
            workflow.nodes as Record<string, unknown>[]
          ),
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
      isOwner,
    };

    return new Response(JSON.stringify(responseData));
  } catch (error) {
    console.error("Failed to get workflow:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to get workflow",
        status: 500,
      })
    );
  }
}

// Helper to build update data from request body
function buildUpdateData(
  body: Record<string, unknown>
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) {
    updateData.name = body.name;
  }
  if (body.description !== undefined) {
    updateData.description = body.description;
  }
  if (body.nodes !== undefined) {
    updateData.nodes = body.nodes;
  }
  if (body.edges !== undefined) {
    updateData.edges = body.edges;
  }
  if (body.visibility !== undefined) {
    updateData.visibility = body.visibility;
  }

  return updateData;
}

async function updateWorkflow({
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

    // Verify ownership
    const existingWorkflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, session.user.id)
      ),
    });

    if (!existingWorkflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    const body = await request.json();

    // Validate that all integrationIds in nodes belong to the current user
    if (Array.isArray(body.nodes)) {
      const validation = await validateWorkflowIntegrations(
        body.nodes,
        session.user.id
      );
      if (!validation.valid) {
        return new Response(
          JSON.stringify({
            error: "Invalid integration references in workflow",
            status: 403,
          })
        );
      }
    }

    // Validate visibility value if provided
    if (
      body.visibility !== undefined &&
      body.visibility !== "private" &&
      body.visibility !== "public"
    ) {
      return new Response(
        JSON.stringify({
          error: "Invalid visibility value. Must be 'private' or 'public'",
          status: 400,
        })
      );
    }

    const updateData = buildUpdateData(body);

    const [updatedWorkflow] = await db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, workflowId))
      .returning();

    if (!updatedWorkflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    return new Response(
      JSON.stringify({
        ...updatedWorkflow,
        createdAt: updatedWorkflow.createdAt.toISOString(),
        updatedAt: updatedWorkflow.updatedAt.toISOString(),
        isOwner: true,
      })
    );
  } catch (error) {
    console.error("Failed to update workflow:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to update workflow",
        status: 500,
      })
    );
  }
}

async function deleteWorkflow({
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

    // Verify ownership
    const existingWorkflow = await db.query.workflows.findFirst({
      where: and(
        eq(workflows.id, workflowId),
        eq(workflows.userId, session.user.id)
      ),
    });

    if (!existingWorkflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", status: 404 })
      );
    }

    await db.delete(workflows).where(eq(workflows.id, workflowId));

    return new Response(JSON.stringify({ success: true }));
  } catch (error) {
    console.error("Failed to delete workflow:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to delete workflow",
        status: 500,
      })
    );
  }
}
