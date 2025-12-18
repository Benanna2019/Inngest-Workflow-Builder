import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { createIntegration, getIntegrations } from "@/lib/db/integrations";
import type {
  IntegrationConfig,
  IntegrationType,
} from "@/lib/types/integration";

export type GetIntegrationsResponse = {
  id: string;
  name: string;
  type: IntegrationType;
  createdAt: string;
  updatedAt: string;
  // Config is intentionally excluded for security
}[];

export type CreateIntegrationRequest = {
  name: string;
  type: IntegrationType;
  config: IntegrationConfig;
};

export type CreateIntegrationResponse = {
  id: string;
  name: string;
  type: IntegrationType;
  createdAt: string;
  updatedAt: string;
};

export const Route = createFileRoute("/api/integrations")({
  server: {
    handlers: {
      GET: getAllIntegrations,
      POST: createNewIntegration,
    },
  },
});

/**
 * GET /api/integrations
 * List all integrations for the authenticated user
 */
async function getAllIntegrations({ request }: { request: Request }) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    // Get optional type filter from query params
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type") as IntegrationType | null;

    const integrations = await getIntegrations(
      session.user.id,
      typeFilter || undefined
    );

    // Return integrations without config for security
    const response: GetIntegrationsResponse = integrations.map(
      (integration) => ({
        id: integration.id,
        name: integration.name,
        type: integration.type,
        createdAt: integration.createdAt.toISOString(),
        updatedAt: integration.updatedAt.toISOString(),
      })
    );

    return new Response(JSON.stringify(response));
  } catch (error) {
    console.error("Failed to get integrations:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to get integrations",
        details: error instanceof Error ? error.message : "Unknown error",
        status: 500,
      })
    );
  }
}

/**
 * POST /api/integrations
 * Create a new integration
 */
async function createNewIntegration({ request }: { request: Request }) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    const body: CreateIntegrationRequest = await request.json();

    if (!(body.name && body.type && body.config)) {
      return new Response(
        JSON.stringify({
          error: "Name, type, and config are required",
          status: 400,
        })
      );
    }

    const integration = await createIntegration(
      session.user.id,
      body.name,
      body.type,
      body.config
    );

    const response: CreateIntegrationResponse = {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };

    return new Response(JSON.stringify(response));
  } catch (error) {
    console.error("Failed to create integration:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to create integration",
        details: error instanceof Error ? error.message : "Unknown error",
        status: 500,
      })
    );
  }
}
