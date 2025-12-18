import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000",
  plugins: [tanstackStartCookies(), anonymousClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
