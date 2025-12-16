import { createRootRoute, HeadContent, Outlet } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ReactFlowProvider } from "@xyflow/react";
import { Provider } from "jotai";
import { type ReactNode, Suspense } from "react";
import { AuthProvider } from "@/components/auth/provider";
import { GitHubStarsLoader } from "@/components/github-stars-loader";
import { GitHubStarsProvider } from "@/components/github-stars-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { PersistentCanvas } from "@/components/workflow/persistent-canvas";
import appCss from "./globals.css?url";

type RootLayoutProps = {
  children: ReactNode;
};

// Inner content wrapped by GitHubStarsProvider (used for both loading and loaded states)
function LayoutContent({ children }: { children: ReactNode }) {
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
  component: RootLayout,
});

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      {/* className={cn(sans.variable, mono.variable, "antialiased")} */}
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <Provider>
            <AuthProvider>
              <Suspense
                fallback={
                  <GitHubStarsProvider stars={null}>
                    <LayoutContent>
                      <Outlet />
                    </LayoutContent>
                  </GitHubStarsProvider>
                }
              >
                <GitHubStarsLoader>
                  <LayoutContent>
                    <Outlet />
                  </LayoutContent>
                </GitHubStarsLoader>
              </Suspense>
              <Toaster />
            </AuthProvider>
          </Provider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
