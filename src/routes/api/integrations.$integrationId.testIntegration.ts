import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/api/integrations/$integrationId/testIntegration"
)({
  server: {
    handlers: {
      POST: testIntegration,
    },
  },
});

import postgres from "postgres";
import { auth } from "@/lib/auth";
import { getIntegration as getIntegrationFromDb } from "@/lib/db/integrations";
import {
  getCredentialMapping,
  getIntegration as getPluginFromRegistry,
} from "@/plugins";

export type TestConnectionResult = {
  status: "success" | "error";
  message: string;
};

async function testIntegration({
  request,
  params,
}: {
  request: Request;
  params: any;
}) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", status: 401 })
      );
    }

    const { integrationId } = await params;

    if (!integrationId) {
      return new Response(
        JSON.stringify({ error: "integrationId is required", status: 400 })
      );
    }

    const integration = await getIntegrationFromDb(
      integrationId,
      session.user.id
    );

    if (!integration) {
      return new Response(
        JSON.stringify({ error: "Integration not found", status: 404 })
      );
    }

    if (integration.type === "database") {
      const result = await testDatabaseConnection(integration.config.url);
      return new Response(JSON.stringify(result));
    }

    const plugin = getPluginFromRegistry(integration.type);

    if (!plugin) {
      return new Response(
        JSON.stringify({ error: "Invalid integration type", status: 400 })
      );
    }

    if (!plugin.testConfig) {
      return new Response(
        JSON.stringify({
          error: "Integration does not support testing",
          status: 400,
        })
      );
    }

    const credentials = getCredentialMapping(plugin, integration.config);

    const testFn = await plugin.testConfig.getTestFunction();
    const testResult = await testFn(credentials);

    const result: TestConnectionResult = {
      status: testResult.success ? "success" : "error",
      message: testResult.success
        ? "Connection successful"
        : testResult.error || "Connection failed",
    };

    return new Response(JSON.stringify(result));
  } catch (error) {
    console.error("Failed to test connection:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to test connection",
        status: 500,
      })
    );
  }
}

async function testDatabaseConnection(
  databaseUrl?: string
): Promise<TestConnectionResult> {
  let connection: postgres.Sql | null = null;

  try {
    if (!databaseUrl) {
      return {
        status: "error",
        message: "Connection failed",
      };
    }

    connection = postgres(databaseUrl, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 5,
    });

    await connection`SELECT 1`;

    return {
      status: "success",
      message: "Connection successful",
    };
  } catch {
    return {
      status: "error",
      message: "Connection failed",
    };
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
