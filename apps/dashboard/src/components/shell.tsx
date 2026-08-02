import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { currentUser, signOut } from "../server/auth.js";
import { OrganizationSwitcher } from "./organization-switcher.js";

export function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  useEffect(() => {
    void currentUser()
      .then((user) => setEmail(user.email))
      .catch(() => setEmail(null));
  }, []);

  const logOut = (): void => {
    void signOut()
      .then(() => navigate({ to: "/login" }))
      .catch(() => undefined);
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col border-x border-border-soft bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border-soft px-5 py-3.5 sm:px-8">
        <div className="flex items-center gap-5">
          <a
            className="text-sm font-semibold tracking-tight text-foreground no-underline"
            href="https://makarima.xyz"
          >
            m<em className="not-italic text-accent-text">T</em>unnel
            <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              dashboard
            </span>
          </a>
          <OrganizationSwitcher />
        </div>
        <div className="relative">
          <button
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            className="max-w-56 truncate text-[13px] text-muted-foreground hover:text-foreground"
            onClick={() => setAccountMenuOpen((open) => !open)}
            type="button"
          >
            {email ?? "account"}
          </button>
          {accountMenuOpen && (
            <div
              className="absolute right-0 top-full z-10 mt-2 min-w-32 border border-border bg-background p-1 shadow-lg"
              role="menu"
            >
              <button
                className="w-full px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={logOut}
                role="menuitem"
                type="button"
              >
                sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="flex flex-1 flex-col sm:flex-row">
        <nav className="flex shrink-0 gap-1 border-b border-border-soft px-5 py-3 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r sm:px-4 sm:py-8">
          <Link
            className="px-3 py-1.5 text-[13px] text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
            to="/"
          >
            assets
          </Link>
          <Link
            className="px-3 py-1.5 text-[13px] text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
            to="/domains"
          >
            domains
          </Link>
          <Link
            className="px-3 py-1.5 text-[13px] text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
            to="/tunnels"
          >
            tunnels
          </Link>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
      <footer className="flex flex-col items-center gap-3 border-t border-border-soft px-5 py-4 text-center sm:flex-row sm:justify-between sm:px-8 sm:text-left">
        <p className="text-xs text-muted-foreground">Copyright © 2026 mTunnel</p>
        <div className="flex flex-wrap justify-center gap-2">
          <a
            className="inline-flex h-7 items-center border border-border bg-background px-2.5 text-xs font-medium text-foreground no-underline transition-colors hover:bg-muted"
            href="https://makarima.xyz/docs"
          >
            Docs
          </a>
          <a
            className="inline-flex h-7 items-center border border-border bg-background px-2.5 text-xs font-medium text-foreground no-underline transition-colors hover:bg-muted"
            href="https://makarima.xyz/terms"
          >
            Terms
          </a>
          <a
            className="inline-flex h-7 items-center border border-border bg-background px-2.5 text-xs font-medium text-foreground no-underline transition-colors hover:bg-muted"
            href="https://github.com/zulfaza/mtunnel"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

export function SectionHeading({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  );
}
