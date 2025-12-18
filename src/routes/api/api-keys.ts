import { createHash, randomBytes } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";

export const Route = createFileRoute("/api/api-keys")({
  server: {
    handlers: {
      GET: getApiKey,
      POST: createApiKey,
    },
  },
});

// Generate a secure API key
function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomPart = randomBytes(24).toString("base64url");
  const key = `wfb_${randomPart}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 11); // "wfb_" + first 7 chars
  return { key, hash, prefix };
}

// GET - List all API keys for the current user
async function getApiKey({ request }: { request: Request }) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ status: 401, error: "Unauthorized" })
      );
    }

    const keys = await db.query.apiKeys.findMany({
      where: eq(apiKeys.userId, session.user.id),
      columns: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });

    return new Response(JSON.stringify(keys));
  } catch (error) {
    console.error("Failed to list API keys:", error);
    return new Response(
      JSON.stringify({ status: 500, error: "Failed to list API keys" })
    );
  }
}

// POST - Create a new API key
export async function createApiKey({ request }: { request: Request }) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ status: 401, error: "Unauthorized" })
      );
    }

    // Check if user is anonymous
    const isAnonymous =
      session.user.name === "Anonymous" ||
      session.user.email?.startsWith("temp-");

    if (isAnonymous) {
      return new Response(
        JSON.stringify({
          status: 403,
          error: "Anonymous users cannot create API keys",
        })
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = body.name || null;

    // Generate new API key
    const { key, hash, prefix } = generateApiKey();

    // Save to database
    const [newKey] = await db
      .insert(apiKeys)
      .values({
        userId: session.user.id,
        name,
        keyHash: hash,
        keyPrefix: prefix,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
      });

    // Return the full key only on creation (won't be shown again)
    return new Response(
      JSON.stringify({
        ...newKey,
        key, // Full key - only returned once!
      })
    );
  } catch (error) {
    console.error("Failed to create API key:", error);
    return new Response(
      JSON.stringify({ status: 500, error: "Failed to create API key" })
    );
  }
}
