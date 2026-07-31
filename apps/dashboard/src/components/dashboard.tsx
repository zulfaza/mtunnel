import logo from "@tunnel/assets/logo-512x512.png";
import type { ReactNode } from "react";

interface Asset {
  readonly name: string;
  readonly path: string;
  readonly size: string;
  readonly updated: string;
}
const assets: readonly Asset[] = [
  { name: "homepage", path: "homepage/index.html", size: "48 KB", updated: "Just now" },
  {
    name: "design-review",
    path: "design-review/index.html",
    size: "1.2 MB",
    updated: "2 days ago",
  },
];

export function Dashboard(): ReactNode {
  return (
    <main className="dashboard">
      <aside>
        <a className="brand" href="https://makarima.xyz">
          <img alt="" src={logo} />
          mtunnel
        </a>
        <nav aria-label="Dashboard navigation">
          <a aria-current="page" href="/">
            Assets
          </a>
          <span>
            Tunnels <small>Soon</small>
          </span>
          <span>
            Domains <small>Soon</small>
          </span>
          <span>
            Tokens <small>Soon</small>
          </span>
        </nav>
        <a className="site-link" href="https://makarima.xyz">
          ← Marketing site
        </a>
      </aside>
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Assets</h1>
            <p>Preview artifacts shared from your CLI.</p>
          </div>
          <button disabled title="Asset uploads are available through mt preview.">
            Upload from CLI
          </button>
        </header>
        <section className="notice">
          <strong>Read-only preview</strong>
          <span>Dashboard authentication and writes will follow the account API.</span>
        </section>
        <section className="asset-list" aria-label="Preview assets">
          <div className="asset-labels">
            <span>Name</span>
            <span>Size</span>
            <span>Updated</span>
          </div>
          {assets.map((asset) => (
            <article key={asset.name}>
              <div>
                <strong>{asset.name}</strong>
                <span>{asset.path}</span>
              </div>
              <span>{asset.size}</span>
              <span>{asset.updated}</span>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
