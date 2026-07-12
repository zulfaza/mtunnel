import { SITE_METADATA } from "./site-metadata.js";

const STYLE = `@font-face{font-family:"Geist Mono";font-style:normal;font-display:swap;font-weight:100 900;src:url(https://cdn.jsdelivr.net/fontsource/fonts/geist-mono:vf@latest/latin-wght-normal.woff2)format("woff2-variations")}
:root{--background:oklch(98.5% .002 84.58);--foreground:oklch(20.5% .01 33.41);--muted:oklch(96.5% .004 84.58);--muted-foreground:oklch(52% .012 35.14);--border:oklch(89% .005 56.44);--border-soft:color-mix(in oklab,var(--border) 80%,transparent);--grid:color-mix(in oklab,var(--border) 72%,transparent);--accent-text:oklch(45% .09 150)}
@media(prefers-color-scheme:dark){:root{--background:oklch(21.5% .009 33.41);--foreground:oklch(94% .004 84.58);--muted:oklch(29% .008 33.41);--muted-foreground:oklch(72% .007 70.08);--border:oklch(100% 0 0/.1);--accent-text:oklch(80% .1 150)}}
*{box-sizing:border-box;margin:0}
html{scroll-behavior:smooth}
::selection{background:color-mix(in oklab,var(--accent-text) 25%,var(--background))}
body{min-height:100svh;font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;line-height:1.75rem;background-color:var(--background);color:var(--foreground);background-image:linear-gradient(to right,var(--grid) 1px,transparent 1px),linear-gradient(to bottom,var(--grid) 1px,transparent 1px);background-size:100% 2.75rem,2.75rem 100%;-webkit-font-smoothing:antialiased}
.frame{display:flex;flex-direction:column;min-height:100svh;width:100%;max-width:72rem;margin:0 auto;border-left:1px solid var(--border-soft);border-right:1px solid var(--border-soft);background:var(--background)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--border-soft);padding:.875rem 1.25rem}
.brand{font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--foreground);text-decoration:none}
.brand em{font-style:normal;color:var(--accent-text)}
nav{display:flex;flex-wrap:wrap;gap:1rem}
nav a{font-size:13px;color:var(--muted-foreground);text-decoration:none;border-bottom:1px solid transparent;padding-bottom:.125rem;transition:color .15s,border-color .15s}
nav a:hover{color:var(--foreground);border-color:color-mix(in oklab,var(--foreground) 40%,transparent)}
.hero{border-bottom:1px solid var(--border-soft);padding:2.5rem 1.25rem 2.75rem}
h1{font-size:1.625rem;font-weight:500;line-height:1.3;letter-spacing:-.01em;max-width:38rem}
.lede{max-width:38rem;font-size:14px;color:var(--muted-foreground);margin-top:1rem}
.lede b{font-weight:500;color:var(--foreground)}
.cols{flex:1;display:flex;flex-direction:column}
section{padding:1.75rem 1.25rem 2.25rem;scroll-margin-top:1rem}
section+section{border-top:1px solid var(--border-soft)}
h2{font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--muted-foreground)}
section p{max-width:38rem;font-size:13px;line-height:1.5rem;color:var(--muted-foreground);margin-top:1rem}
section a{color:var(--accent-text);text-decoration:none;border-bottom:1px solid color-mix(in oklab,var(--accent-text) 40%,transparent)}
section a:hover{border-color:var(--accent-text)}
code{font-family:inherit;font-size:12px;border:1px solid var(--border-soft);background:var(--muted);padding:.05rem .375rem;white-space:nowrap}
.code{position:relative;margin-top:1rem;border:1px solid var(--border-soft);background:var(--muted);padding:1rem 4rem 1rem 1.25rem;font-size:13px;line-height:1.9;overflow-x:auto;font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0}
.copy{position:absolute;top:.5rem;right:.5rem;display:inline-flex;align-items:center;justify-content:center;width:1.625rem;height:1.625rem;padding:0;border:1px solid var(--border);background:var(--background);color:var(--muted-foreground);cursor:pointer;transition:background-color .15s,color .15s}
.copy svg{width:.8125rem;height:.8125rem}
.copy:hover{background:var(--muted);color:var(--foreground)}
.copy[data-done]{color:var(--accent-text);border-color:color-mix(in oklab,var(--accent-text) 40%,var(--border))}
.code b{font-weight:400;color:var(--accent-text);white-space:pre}
.code i{font-style:normal;color:var(--muted-foreground);user-select:none;white-space:pre}
ul{list-style:none;padding:0;margin-top:1rem;border-top:1px solid var(--border-soft)}
li{display:flex;flex-wrap:wrap;align-items:baseline;gap:.375rem .75rem;padding:.625rem 0;border-bottom:1px solid var(--border-soft);font-size:13px;line-height:1.5rem;color:var(--muted-foreground)}
li code{color:var(--foreground)}
.error-status{font-size:3.5rem;font-weight:500;line-height:1.1;letter-spacing:-.02em}
.error-code{display:block;margin-top:1.5rem;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted-foreground)}
.grow{flex:1}
.docs{flex:1;display:flex;flex-direction:column;align-items:stretch}
.docs-body{display:flex;flex-direction:column}
.toc{padding:1.25rem;border-bottom:1px solid var(--border-soft)}
.toc ol{list-style:none;padding:0;margin:.625rem 0 0;display:flex;flex-wrap:wrap;gap:.25rem 1.25rem}
.toc li{display:block;padding:0;border:0}
.toc a{font-size:13px;color:var(--muted-foreground);text-decoration:none;border-bottom:1px solid transparent;transition:color .15s,border-color .15s}
.toc a:hover{color:var(--foreground);border-color:color-mix(in oklab,var(--foreground) 40%,transparent)}
.footer-links{display:flex;gap:.5rem}
footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem;border-top:1px solid var(--border-soft);border-bottom:1px solid var(--border-soft);padding:1rem 1.25rem}
footer p{font-size:12px;color:var(--muted-foreground)}
.btn{display:inline-flex;align-items:center;height:1.75rem;padding:0 .625rem;border:1px solid var(--border);background:var(--background);color:var(--foreground);font-size:12px;font-weight:500;white-space:nowrap;text-decoration:none;transition:background-color .15s}
.btn:hover{background:var(--muted)}
.reveal{opacity:0;animation:rise .5s cubic-bezier(.22,1,.36,1) forwards}
.reveal:nth-child(2){animation-delay:.06s}.reveal:nth-child(3){animation-delay:.12s}.reveal:nth-child(4){animation-delay:.18s}.reveal:nth-child(5){animation-delay:.24s}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.reveal{animation:none;opacity:1}}
@media(min-width:640px){.bar{padding:.875rem 2rem}.hero{padding:3.25rem 2rem 3.5rem}section{padding:2rem}footer{padding:1rem 2rem}h1{font-size:2rem}.toc{padding:1.25rem 2rem}}
@media(min-width:1024px){.cols{display:grid;grid-template-columns:1fr 1fr;align-items:stretch}.cols section+section{border-top:0;border-left:1px solid var(--border-soft)}.docs{display:grid;grid-template-columns:15rem 1fr;align-items:start}.docs-body{border-left:1px solid var(--border-soft);min-height:100%}.toc{position:sticky;top:0;border-bottom:0;padding:2rem}.toc ol{flex-direction:column;gap:.5rem}}`;

const COPY_SCRIPT = `(function(){var copyIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="0"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';var checkIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';document.querySelectorAll(".code").forEach(function(block){var btn=document.createElement("button");btn.className="copy";btn.type="button";btn.innerHTML=copyIcon;btn.setAttribute("aria-label","Copy commands");btn.addEventListener("click",function(){var text=Array.prototype.map.call(block.querySelectorAll("b"),function(b){return b.textContent}).join("\\n");navigator.clipboard.writeText(text).then(function(){btn.innerHTML=checkIcon;btn.setAttribute("data-done","");setTimeout(function(){btn.innerHTML=copyIcon;btn.removeAttribute("data-done")},1500)}).catch(function(){})});block.appendChild(btn)})})()`;

interface PageMetadata {
  readonly title: string;
  readonly path: string;
}

function page(metadata: PageMetadata, body: string, status: number = 200): Response {
  const pageUrl = new URL(metadata.path, SITE_METADATA.origin).toString();
  const socialImageUrl = new URL(SITE_METADATA.socialImage.path, SITE_METADATA.origin).toString();
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${metadata.title}</title><meta name="description" content="${SITE_METADATA.description}"><meta name="theme-color" content="${SITE_METADATA.themeColor}"><link rel="canonical" href="${pageUrl}"><link rel="icon" href="${SITE_METADATA.icons.favicon}"><link rel="icon" type="image/png" sizes="32x32" href="${SITE_METADATA.icons.large}"><link rel="icon" type="image/png" sizes="16x16" href="${SITE_METADATA.icons.small}"><link rel="apple-touch-icon" sizes="180x180" href="${SITE_METADATA.icons.appleTouch}"><link rel="manifest" href="${SITE_METADATA.manifestPath}"><meta property="og:type" content="${SITE_METADATA.openGraphType}"><meta property="og:site_name" content="${SITE_METADATA.name}"><meta property="og:title" content="${metadata.title}"><meta property="og:description" content="${SITE_METADATA.description}"><meta property="og:url" content="${pageUrl}"><meta property="og:image" content="${socialImageUrl}"><meta property="og:image:alt" content="${SITE_METADATA.socialImage.alt}"><meta property="og:image:width" content="${SITE_METADATA.socialImage.width}"><meta property="og:image:height" content="${SITE_METADATA.socialImage.height}"><meta name="twitter:card" content="${SITE_METADATA.twitterCard}"><meta name="twitter:title" content="${metadata.title}"><meta name="twitter:description" content="${SITE_METADATA.description}"><meta name="twitter:image" content="${socialImageUrl}"><style>${STYLE}</style></head><body><div class="frame">${body}</div><script>${COPY_SCRIPT}</script></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

function bar(navLinks: string): string {
  return `<div class="bar reveal"><a class="brand" href="https://makarima.xyz">makarima<em>.xyz</em></a><nav aria-label="Primary navigation">${navLinks}</nav></div>`;
}

function footer(): string {
  return `<footer class="reveal"><p>Copyright © 2026 makarima.xyz</p><div class="footer-links"><a class="btn" href="https://makarima.xyz/docs">Docs</a><a class="btn" href="https://makarima.xyz/terms">Terms</a><a class="btn" href="https://github.com/zul/mtunnel" rel="noreferrer" target="_blank">GitHub</a></div></footer>`;
}

export function landingPage(): Response {
  return page(
    SITE_METADATA.pages.home,
    bar(
      `<a href="#install">Install</a><a href="#use">Use</a><a href="https://makarima.xyz/docs">Docs</a><a href="https://github.com/zul/mtunnel" rel="noreferrer" target="_blank">GitHub</a>`,
    ) +
      `<header class="hero reveal"><h1>Your localhost, on the internet.</h1><p class="lede">One command opens a <b>tunnel</b>: the CLI holds a WebSocket to Cloudflare's edge, a Durable Object routes public requests down it to your machine, and responses stream back. Sign in with Google from the terminal, get a stable subdomain, and idle tunnels shut themselves down.</p></header><div class="cols reveal"><section id="install"><h2>Install</h2><div class="code"><i>$ </i><b>curl https://makarima.xyz/install.sh | sh</b></div><p>Drops a single static binary in <code>~/.local/bin</code> (Linux &amp; macOS, amd64 &amp; arm64). No runtime dependencies.</p></section><section id="use"><h2>Use</h2><div class="code"><i>$ </i><b>mt login</b><i>                      # sign in with Google</i><br><i>$ </i><b>mt http 3000</b><i>                  # expose localhost:3000</i><br><i>$ </i><b>mt http 3000 --name demo</b><i>      # stable subdomain</i></div><ul><li><code>mt status</code> — connection state and public URL</li><li><code>mt domain add &lt;hostname&gt; --name &lt;tunnel&gt;</code> — route a custom domain to a tunnel</li><li><code>mt update</code> — self-update to the latest release</li></ul><p>Full command reference and feature guide in the <a href="https://makarima.xyz/docs">docs</a>.</p></section></div>` +
      footer(),
  );
}

export function docsPage(): Response {
  return page(
    SITE_METADATA.pages.docs,
    bar(
      `<a href="https://makarima.xyz/#install">Install</a><a href="https://makarima.xyz/#use">Use</a><a href="https://makarima.xyz/docs">Docs</a><a href="https://github.com/zul/mtunnel" rel="noreferrer" target="_blank">GitHub</a>`,
    ) +
      `<header class="hero reveal"><h1>Docs</h1><p class="lede">Everything the <b>mt</b> CLI and the makarima.xyz edge can do: tunnels, named subdomains, project config, custom domains, and the limits that apply to your organization.</p></header><div class="docs reveal"><aside class="toc"><h2>On this page</h2><ol><li><a href="#install">Install &amp; update</a></li><li><a href="#auth">Sign in</a></li><li><a href="#tunnels">Tunnels</a></li><li><a href="#config">Config files</a></li><li><a href="#domains">Custom domains</a></li><li><a href="#limits">Limits</a></li><li><a href="#how">How it works</a></li></ol></aside><div class="docs-body">` +
      `<section id="install"><h2>Install &amp; update</h2><div class="code"><i>$ </i><b>curl https://makarima.xyz/install.sh | sh</b></div><p>Installs a single static <code>mt</code> binary to <code>~/.local/bin</code> (override with <code>INSTALL_DIR</code>). Linux and macOS, amd64 and arm64. <code>mt update</code> re-runs the installer to fetch the latest release; <code>mt version</code> prints the installed version.</p></section>` +
      `<section id="auth"><h2>Sign in</h2><div class="code"><i>$ </i><b>mt login</b></div><p>Starts a WorkOS device-authorization flow: the CLI prints a URL and code, you approve it in the browser with your Google account, and tokens are stored in the CLI config. Access tokens refresh automatically while a tunnel is running. Each account belongs to an organization, which owns its tunnels and domains.</p></section>` +
      `<section id="tunnels"><h2>Tunnels</h2><div class="code"><i>$ </i><b>mt http 3000</b><i>                  # random subdomain</i><br><i>$ </i><b>mt http 3000 --name demo</b><i>      # stable subdomain</i><br><i>$ </i><b>mt http api</b><i>                   # named tunnel from project config</i></div><p><code>mt http &lt;port&gt;</code> exposes a local port on a <code>*.makarima.xyz</code> subdomain. Without <code>--name</code> you get a random name; with it, a stable one you can reconnect to. Passing a name instead of a port looks the tunnel up in the nearest <code>mtunnel.config.json</code>, which maps tunnel names to a port and optional upstream hostname, so a repo can check in its tunnel setup.</p><ul><li><code>mt status [tunnel-id]</code> — connection state and public URL</li><li><code>--hostname</code> — local upstream host (default <code>localhost</code>)</li><li><code>--request-timeout</code> — upstream request timeout (default 30s)</li><li><code>--idle-timeout</code> — client-side idle shutdown (default 15m, 0 disables)</li></ul></section>` +
      `<section id="config"><h2>Config files</h2><div class="code"><b>{</b><br><b>  "tunnels": {</b><br><b>    "api":  { "port": 3000 },</b><br><b>    "web":  { "port": 5173, "hostname": "127.0.0.1" }</b><br><b>  }</b><br><b>}</b></div><p>A <code>mtunnel.config.json</code> checked into your repo maps tunnel names to a local port and optional upstream hostname. The CLI searches from the working directory upward, so it works from any subdirectory. With the example above, <code>mt http api</code> exposes port 3000 as the named tunnel <code>api</code> — same stable subdomain every time, no flags to remember.</p><p>Credentials live separately in the CLI config at <code>~/.config/tunnel/config.json</code> (or your OS config dir), written by <code>mt login</code>: the server URL and access/refresh tokens. Override the location with <code>--config</code>; never commit this file.</p></section>` +
      `<section id="domains"><h2>Custom domains</h2><div class="code"><i>$ </i><b>mt domain add dev.example.com --name demo</b><br><i>$ </i><b>mt domain verify dev.example.com</b><br><i>$ </i><b>mt domain status dev.example.com</b></div><p><code>mt domain add</code> registers a hostname for a named tunnel and prints the DNS records to create: a CNAME pointing at the service and a TXT record proving you control the name. Once the records exist, <code>mt domain verify</code> checks DNS and provisions the certificate; <code>mt domain status</code> shows provisioning progress. <code>mt domain list</code> shows your domains with tunnel, status, and last use; <code>mt domain delete</code> removes one.</p></section>` +
      `<section id="limits"><h2>Limits</h2><p>Standard organizations can run up to <b>3 concurrent tunnels</b> and <b>1 custom domain</b>. Tunnels are closed after <b>15 minutes idle</b> and after <b>1 hour</b> regardless of activity — reconnecting with the same <code>--name</code> gets the same subdomain back. Unrestricted organizations have none of these limits.</p></section>` +
      `<section id="how"><h2>How it works</h2><p>The CLI opens a WebSocket to a Cloudflare Worker, which pins each tunnel to its own Durable Object. Public requests to your subdomain (or custom domain) hit the Worker, are routed to that Durable Object, streamed down the WebSocket to your machine, and the response streams back. Request and response bodies are not stored; the edge compresses responses for the browser.</p><p>Global flags: <code>--server</code> (override server URL), <code>--config</code> (config file path), <code>--token</code> (override stored auth), <code>--log-level</code> (debug, info, warn, error).</p></section>` +
      `</div></div>` +
      footer(),
  );
}

export function termsPage(): Response {
  return page(
    SITE_METADATA.pages.terms,
    bar(
      `<a href="https://makarima.xyz">Home</a><a href="https://makarima.xyz/docs">Docs</a><a href="https://github.com/zul/mtunnel" rel="noreferrer" target="_blank">GitHub</a>`,
    ) +
      `<header class="hero reveal"><h1>Terms of Service</h1><p class="lede">Makarima is a development tunnel service that exposes a local HTTP server on the internet. By creating an account or opening a tunnel, you agree to these terms.</p></header><div class="grow reveal"><section><h2>The service</h2><p>The <code>mt</code> CLI connects your machine to Cloudflare's edge and routes public requests on a <code>makarima.xyz</code> subdomain (or a custom domain you configure) to a local port you choose. The service is intended for development and testing, not for hosting production workloads.</p></section><section><h2>Accounts</h2><p>You sign in with a Google account through WorkOS. Each account belongs to an organization, which owns its tunnels and domains. We store the minimum needed to operate the service: your account and organization identifiers, email address, and the tunnels and domains you register. You are responsible for activity that happens through your account and tunnels.</p></section><section><h2>Acceptable use</h2><p>Traffic through your tunnel is your responsibility. Don't use the service to distribute malware, phish, infringe copyright, evade network policies you are bound by, or expose services you don't have the right to expose. Custom domains may only be added for hostnames you control. We may block traffic or close tunnels that abuse the service or burden the network.</p></section><section><h2>Availability</h2><p>The service is provided on a best-effort basis with no uptime guarantee. Usage limits apply per organization (see the <a href="https://makarima.xyz/docs">docs</a>): idle and long-running tunnels are shut down automatically, concurrent tunnels and custom domains are capped, and subdomain assignments may change unless you use a named tunnel. We may change or discontinue the service at any time.</p></section><section><h2>Privacy</h2><p>Tunnel traffic passes through Cloudflare and is forwarded to your machine; we do not store request or response bodies. Operational logs (connection metadata, error events) are kept only as long as needed to run and debug the service.</p></section><section><h2>Termination</h2><p>You can stop using the service at any time; closing your tunnels and deleting the CLI removes your access. We may suspend or terminate accounts that violate these terms.</p></section><section><h2>Disclaimer</h2><p>The service and the CLI are provided "as is", without warranty of any kind. To the maximum extent permitted by law, makarima.xyz is not liable for damages arising from use of the service, including data loss or exposure of services you tunnel.</p></section><section><h2>Changes</h2><p>We may update these terms; the current version is always at <code>makarima.xyz/terms</code>. Continued use after a change means you accept these terms. Questions: open an issue on <a href="https://github.com/zul/mtunnel" rel="noreferrer" target="_blank">GitHub</a>.</p></section></div>` +
      footer(),
  );
}

export function errorPage(status: number, code: string, detail: string): Response {
  return page(
    { title: `${status} — Makarima`, path: "/" },
    bar(`<a href="https://makarima.xyz">Home</a>`) +
      `<section class="grow reveal"><h2>Error</h2><h1 class="error-status">${status}</h1><p>${detail}</p><small class="error-code">${code}</small></section>` +
      footer(),
    status,
  );
}

export function siteManifest(): Response {
  return new Response(
    JSON.stringify({
      id: "/",
      name: SITE_METADATA.name,
      short_name: SITE_METADATA.name,
      description: SITE_METADATA.description,
      icons: [
        {
          src: SITE_METADATA.icons.androidSmall,
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: SITE_METADATA.icons.androidLarge,
          sizes: "512x512",
          type: "image/png",
        },
      ],
      start_url: "/",
      scope: "/",
      theme_color: SITE_METADATA.themeColor,
      background_color: SITE_METADATA.themeColor,
      display: "standalone",
    }),
    {
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}

export function installScript(): Response {
  const script = `#!/bin/sh\nset -eu\nrepo=zul/mtunnel\nos=$(uname -s | tr '[:upper:]' '[:lower:]')\narch=$(uname -m)\ncase "$arch" in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; *) echo "unsupported architecture: $arch" >&2; exit 1;; esac\ncase "$os" in darwin|linux) ;; *) echo "unsupported OS: $os" >&2; exit 1;; esac\nasset="mt-$os-$arch.tar.gz"\ntmp=$(mktemp -d)\ntrap 'rm -rf "$tmp"' EXIT\ncurl -fsSL "https://github.com/$repo/releases/latest/download/$asset" -o "$tmp/mt.tar.gz"\ncurl -fsSL "https://github.com/$repo/releases/latest/download/$asset.sha256" -o "$tmp/mt.tar.gz.sha256"\nexpected=$(awk '{print $1}' "$tmp/mt.tar.gz.sha256")\nif command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/mt.tar.gz" | awk '{print $1}'); else actual=$(shasum -a 256 "$tmp/mt.tar.gz" | awk '{print $1}'); fi\nif [ "$expected" != "$actual" ]; then echo "checksum mismatch for $asset" >&2; exit 1; fi\ntar -xzf "$tmp/mt.tar.gz" -C "$tmp"\ndest="\${INSTALL_DIR:-$HOME/.local/bin}"\nmkdir -p "$dest"\ninstall -m 0755 "$tmp/mt" "$dest/mt"\necho "installed mt to $dest/mt"\n`;
  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
