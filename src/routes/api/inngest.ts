import { createFileRoute } from "@tanstack/react-router";
import { serve } from "inngest/edge";
import { inngest } from "@/lib/inngest/client";
import { allFunctions } from "@/lib/inngest/functions";

// Lazy load server-only modules to prevent client bundling
const handler = serve({ client: inngest, functions: allFunctions });

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: async ({ request }) => await handler(request),
      POST: async ({ request }) => await handler(request),
      PUT: async ({ request }) => await handler(request),
    },
  },
});
