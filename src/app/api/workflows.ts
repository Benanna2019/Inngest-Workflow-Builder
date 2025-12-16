import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";

export const Route = createFileRoute("/api/workflows")({
  server: {
    handlers: {
      GET: getUserWorkflows,
    },
  },
});

async function getUserWorkflows({ request }: { request: Request }) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(JSON.stringify([]));
    }

    const userWorkflows = await db
      .select()
      .from(workflows)
      .where(eq(workflows.userId, session.user.id))
      .orderBy(desc(workflows.updatedAt));

    const mappedWorkflows = userWorkflows.map((workflow) => ({
      ...workflow,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    }));

    return new Response(JSON.stringify(mappedWorkflows));
  } catch (error) {
    console.error("Failed to get workflows:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to get workflows",
        status: 500,
      })
    );
  }
}
