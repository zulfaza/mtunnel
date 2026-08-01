import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SectionHeading, Shell } from "../components/shell.js";
import { completeLogin } from "../server/auth.js";

export interface CallbackSearch {
  readonly code: string | undefined;
  readonly state: string | undefined;
  readonly error: string | undefined;
  readonly error_description: string | undefined;
}

export const Route = createFileRoute("/callback")({
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  component: CallbackPage,
});

function CallbackPage(): ReactNode {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);
  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;
    if (search.error !== undefined) {
      setError(search.error_description ?? search.error);
      return;
    }
    if (search.code === undefined || search.state === undefined) {
      setError("Missing authorization code.");
      return;
    }
    completeLogin({ data: { code: search.code, state: search.state } })
      .then(() => navigate({ to: "/" }))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Sign in failed.");
      });
  }, [navigate, search]);
  return (
    <Shell>
      <section className="flex-1 px-5 py-12 sm:px-8">
        <SectionHeading>Signing in</SectionHeading>
        {error === null ? (
          <p className="mt-4 text-[13px] text-muted-foreground">Completing sign in…</p>
        ) : (
          <>
            <p className="mt-4 text-[13px] text-destructive">{error}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              <Link className="text-accent-text underline-offset-4 hover:underline" to="/login">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </section>
    </Shell>
  );
}
