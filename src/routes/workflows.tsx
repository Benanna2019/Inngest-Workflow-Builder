"use client";

import {
  createFileRoute,
  Outlet,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/workflows")({
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const router = useRouter();
  const location = useLocation();

  // Only redirect if we're at exactly /workflows (not a child route like /workflows/abc)
  const isExactMatch = location.pathname === "/workflows";

  useEffect(() => {
    if (!isExactMatch) {
      return;
    }

    const redirectToWorkflow = async () => {
      try {
        const workflows = await api.workflow.getAll();
        // Filter out the auto-save workflow
        const filtered = workflows.filter((w) => w.name !== "__current__");

        if (filtered.length > 0) {
          // Sort by updatedAt descending to get most recent
          const mostRecent = filtered.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0];
          router.navigate({
            to: "/workflows/$workflowId",
            params: { workflowId: mostRecent.id },
            search: { generating: undefined },
          });
        } else {
          // No workflows, redirect to homepage
          router.navigate({ to: "/" });
        }
      } catch (error) {
        console.error("Failed to load workflows:", error);
        router.navigate({ to: "/" });
      }
    };

    redirectToWorkflow();
  }, [router, isExactMatch]);

  // Render Outlet so child routes (like /workflows/$workflowId) can display
  return <Outlet />;
}
