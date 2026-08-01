import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { beginLogin, currentUser } from "../server/auth.js";
import { Globe } from "./globe.js";
import { Button } from "./ui/button.js";

interface AuthPageContent {
  readonly heading: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly submitLabel: string;
  readonly footer: ReactNode;
}

export function AuthPage({
  screenHint,
  content,
}: {
  readonly screenHint: "sign-in" | "sign-up";
  readonly content: AuthPageContent;
}): ReactNode {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void currentUser()
      .then(() => navigate({ to: "/" }))
      .catch(() => undefined);
  }, [navigate]);
  const begin = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await beginLogin({ data: { screenHint } });
      window.location.assign(result.url);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "Could not start sign in.");
    }
  };
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a
            className="text-sm font-semibold tracking-tight text-foreground no-underline"
            href="https://makarima.xyz"
          >
            m<em className="not-italic text-accent-text">T</em>unnel
            <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              dashboard
            </span>
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {content.heading}
                </p>
                <h1 className="text-2xl font-medium leading-snug tracking-tight">
                  {content.title}
                </h1>
                <p className="text-[13px] leading-6 text-muted-foreground">{content.description}</p>
              </div>
              <Button
                className="h-9 w-full"
                disabled={busy}
                onClick={() => void begin()}
                type="button"
                variant="primary"
              >
                {busy ? "Redirecting…" : content.submitLabel}
              </Button>
              {error !== null && <p className="text-[13px] text-destructive">{error}</p>}
              <p className="text-center text-[13px] text-muted-foreground">{content.footer}</p>
            </div>
          </div>
        </div>
        <p className="text-center text-xs leading-6 text-muted-foreground md:text-left">
          Same account as the CLI —{" "}
          <code className="border border-border-soft bg-muted px-1.5 text-xs">mt login</code> from
          the terminal.
        </p>
      </div>
      <div className="relative hidden flex-col items-center justify-center gap-10 overflow-hidden border-l border-border-soft bg-muted lg:flex">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to bottom, var(--grid) 1px, transparent 1px)",
            backgroundSize: "100% 2.75rem, 2.75rem 100%",
          }}
        />
        <div className="relative w-[19rem]">
          <Globe />
        </div>
        <div className="relative w-[19rem] border border-border-soft bg-background px-5 py-3 text-[13px] leading-7">
          <p>
            <span className="select-none text-muted-foreground">$ </span>
            <span className="text-accent-text">mt http 3000</span>
          </p>
          <p className="text-muted-foreground">
            https://demo.makarima.xyz
            <span
              className="ml-1 inline-block h-3.5 w-[7px] translate-y-0.5 bg-accent-text"
              style={{ animation: "cursor-blink 1.1s step-end infinite" }}
            />
          </p>
        </div>
      </div>
    </div>
  );
}

export function loginContent(): AuthPageContent {
  return {
    heading: "Sign in",
    title: "Welcome back.",
    description: "Sign in with WorkOS to manage your tunnels and preview assets.",
    submitLabel: "Continue with WorkOS",
    footer: (
      <>
        No account?{" "}
        <Link className="text-accent-text underline-offset-4 hover:underline" to="/register">
          Sign up
        </Link>
      </>
    ),
  };
}

export function registerContent(): AuthPageContent {
  return {
    heading: "Create account",
    title: "Your localhost, on the internet.",
    description: "Create a WorkOS account to share local servers and previews in seconds.",
    submitLabel: "Continue with WorkOS",
    footer: (
      <>
        Already registered?{" "}
        <Link className="text-accent-text underline-offset-4 hover:underline" to="/login">
          Sign in
        </Link>
      </>
    ),
  };
}
