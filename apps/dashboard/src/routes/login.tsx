import { createFileRoute, redirect } from "@tanstack/react-router";
import { beginLogin } from "../server/auth.js";

export const Route = createFileRoute("/login")({
  loader: async () => {
    const login = await beginLogin({ data: { screenHint: "sign-in" } });
    throw redirect({ href: login.url });
  },
});
