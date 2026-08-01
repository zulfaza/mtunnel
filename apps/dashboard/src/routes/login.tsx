import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AuthPage, loginContent } from "../components/auth-page.js";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage(): ReactNode {
  return <AuthPage content={loginContent()} screenHint="sign-in" />;
}
