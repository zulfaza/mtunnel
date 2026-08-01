import type { ReactNode } from "react";

export function Shell({
  children,
  actions,
}: {
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}): ReactNode {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col border-x border-border-soft bg-background">
      <div className="flex items-center justify-between gap-4 border-b border-border-soft px-5 py-3.5 sm:px-8">
        <a
          className="text-sm font-semibold tracking-tight text-foreground no-underline"
          href="https://makarima.xyz"
        >
          m<em className="not-italic text-accent-text">T</em>unnel
          <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            dashboard
          </span>
        </a>
        <nav className="flex flex-wrap items-center gap-4">
          <a
            className="border-b border-transparent pb-0.5 text-[13px] text-muted-foreground no-underline transition-colors hover:border-foreground/40 hover:text-foreground"
            href="https://makarima.xyz/docs"
          >
            docs
          </a>
          {actions}
        </nav>
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
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
