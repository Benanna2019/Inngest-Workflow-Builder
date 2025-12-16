import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";

export const Route = createFileRoute("/api/api-keys/$keyId")({
  server: {
    handlers: {
      DELETE: deleteApiKey,
    },
  },
});

// DELETE - Delete an API key
// need to look at how to type params on tanstack server
async function deleteApiKey({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { keyId } = await params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ status: 401, error: "Unauthorized" })
      );
    }

    // Delete the key (only if it belongs to the user)
    const result = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, session.user.id)))
      .returning({ id: apiKeys.id });

    if (result.length === 0) {
      return new Response(
        JSON.stringify({ status: 404, error: "API key not found" })
      );
    }

    return new Response(JSON.stringify({ success: true }));
  } catch (error) {
    console.error("Failed to delete API key:", error);
    return new Response(
      JSON.stringify({ status: 500, error: "Failed to delete API key" })
    );
  }
}
