import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import {
  deleteIntegration,
  getIntegration,
  updateIntegration,
} from "@/lib/db/integrations";
import type { IntegrationConfig } from "@/lib/types/integration";

export type GetIntegrationResponse = {
  id: string;
  name: string;
  type: string;
  config: IntegrationConfig;
  createdAt: string;
  updatedAt: string;
};

export type UpdateIntegrationRequest = {
  name?: string;
  config?: IntegrationConfig;
};

export const Route = createFileRoute("/api/integrations/$integrationId")({
  server: {
    handlers: {
      GET: getIntegrationById,
      PUT: update,
      DELETE: deleteSpecifiedIntegration,
    },
  },
});

/**
 * GET /api/integrations/[integrationId]
 * Get a single integration with decrypted config
 */
export async function getIntegrationById({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { integrationId } = await params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    const integration = await getIntegration(integrationId, session.user.id);

    if (!integration) {
      return new Response(
        JSON.stringify({ error: "Integration not found", status: 404 })
      );
    }

    const response: GetIntegrationResponse = {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      config: integration.config,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };

    return new Response(JSON.stringify(response));
  } catch (error) {
    console.error("Failed to get integration:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to get integration",
        details: error instanceof Error ? error.message : "Unknown error",
        status: 500,
      })
    );
  }
}

/**
 * PUT /api/integrations/[integrationId]
 * Update an integration
 */
async function update({ request, params }: { request: Request; params: any }) {
  try {
    const { integrationId } = await params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    const body: UpdateIntegrationRequest = await request.json();

    const integration = await updateIntegration(
      integrationId,
      session.user.id,
      body
    );

    if (!integration) {
      return new Response(
        JSON.stringify({ error: "Integration not found", status: 404 })
      );
    }

    const response: GetIntegrationResponse = {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      config: integration.config,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };

    return new Response(JSON.stringify(response));
  } catch (error) {
    console.error("Failed to update integration:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to update integration",
        details: error instanceof Error ? error.message : "Unknown error",
        status: 500,
      })
    );
  }
}

/**
 * DELETE /api/integrations/[integrationId]
 * Delete an integration
 */
async function deleteSpecifiedIntegration({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const { integrationId } = await params;
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    const success = await deleteIntegration(integrationId, session.user.id);

    if (!success) {
      return new Response(
        JSON.stringify({ error: "Integration not found", status: 404 })
      );
    }

    return new Response(JSON.stringify({ success: true }));
  } catch (error) {
    console.error("Failed to delete integration:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to delete integration",
        details: error instanceof Error ? error.message : "Unknown error",
        status: 500,
      })
    );
  }
}
