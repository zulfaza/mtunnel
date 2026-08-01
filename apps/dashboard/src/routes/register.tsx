import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AuthPage, registerContent } from "../components/auth-page.js";

export const Route = createFileRoute("/register")({ component: RegisterPage });

function RegisterPage(): ReactNode {
  return <AuthPage content={registerContent()} screenHint="sign-up" />;
}
