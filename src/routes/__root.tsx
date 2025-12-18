import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { ReactFlowProvider } from "@xyflow/react";
import { Provider } from "jotai";
import { AuthProvider } from "@/components/auth/provider";
// import { GitHubStarsLoader } from "@/components/github-stars-loader";
// import { GitHubStarsProvider } from "@/components/github-stars-provider";
import { Toaster } from "@/components/ui/sonner";
import { PersistentCanvas } from "@/components/workflow/persistent-canvas";
import appCss from "@/globals.css?url";
import "@xyflow/react/dist/style.css";

// Inner content wrapped by GitHubStarsProvider (used for both loading and loaded states)
function LayoutContent({ children }: { children: React.ReactNode }) {
  return (
    <ReactFlowProvider>
      <PersistentCanvas />
      <div className="pointer-events-none relative z-10">{children}</div>
    </ReactFlowProvider>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      { title: "TanStack Start Starter" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Provider>
        <AuthProvider>
          {/* <Suspense
                fallback={
                  // <GitHubStarsProvider stars={null}>
                    <LayoutContent>
                      <Outlet />
                    </LayoutContent>
                  // </GitHubStarsProvider>
                }
              > */}
          {/* <GitHubStarsLoader> */}
          <LayoutContent>
            <Outlet />
          </LayoutContent>
          {/* </GitHubStarsLoader> */}
          {/* </Suspense> */}
          <Toaster />
        </AuthProvider>
      </Provider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
