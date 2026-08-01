import { SITE_METADATA } from "../../site-metadata.js";

const STYLE = `@font-face{font-family:"Geist Mono";font-style:normal;font-display:swap;font-weight:100 900;src:url(https://cdn.jsdelivr.net/fontsource/fonts/geist-mono:vf@latest/latin-wght-normal.woff2)format("woff2-variations")}
:root{--background:oklch(98.5% .002 84.58);--foreground:oklch(20.5% .01 33.41);--muted:oklch(96.5% .004 84.58);--muted-foreground:oklch(52% .012 35.14);--border:oklch(89% .005 56.44);--border-soft:color-mix(in oklab,var(--border) 80%,transparent);--grid:color-mix(in oklab,var(--border) 72%,transparent);--accent-text:oklch(45% .09 150)}
@media(prefers-color-scheme:dark){:root{--background:oklch(21.5% .009 33.41);--foreground:oklch(94% .004 84.58);--muted:oklch(29% .008 33.41);--muted-foreground:oklch(72% .007 70.08);--border:oklch(100% 0 0/.1);--accent-text:oklch(80% .1 150)}}
*{box-sizing:border-box;margin:0}
::selection{background:color-mix(in oklab,var(--accent-text) 25%,var(--background))}
body{min-height:100svh;font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;line-height:1.75rem;background-color:var(--background);color:var(--foreground);background-image:linear-gradient(to right,var(--grid) 1px,transparent 1px),linear-gradient(to bottom,var(--grid) 1px,transparent 1px);background-size:100% 2.75rem,2.75rem 100%;-webkit-font-smoothing:antialiased}
.frame{display:flex;flex-direction:column;min-height:100svh;width:100%;max-width:72rem;margin:0 auto;border-left:1px solid var(--border-soft);border-right:1px solid var(--border-soft);background:var(--background)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--border-soft);padding:.875rem 1.25rem}
.brand{font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--foreground);text-decoration:none}
.brand em{font-style:normal;color:var(--accent-text)}
nav{display:flex;flex-wrap:wrap;gap:1rem}
nav a{font-size:13px;color:var(--muted-foreground);text-decoration:none;border-bottom:1px solid transparent;padding-bottom:.125rem;transition:color .15s,border-color .15s}
nav a:hover{color:var(--foreground);border-color:color-mix(in oklab,var(--foreground) 40%,transparent)}
h1{font-size:1.625rem;font-weight:500;line-height:1.3;letter-spacing:-.01em;max-width:38rem}
h2{font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--muted-foreground)}
section{padding:1.75rem 1.25rem 2.25rem}
section p{max-width:38rem;font-size:13px;line-height:1.5rem;color:var(--muted-foreground);margin-top:1rem}
.grow{flex:1}
.error-status{font-size:3.5rem;font-weight:500;line-height:1.1;letter-spacing:-.02em}
.error-code{display:block;margin-top:1.5rem;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted-foreground)}
.code-form{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1.25rem;max-width:24rem}
.code-form input{flex:1;min-width:12rem;height:1.75rem;padding:0 .5rem;border:1px solid var(--border);background:var(--background);color:var(--foreground);font:inherit;font-size:13px;border-radius:0}
.code-form input:focus{outline:1px solid var(--accent-text);outline-offset:-1px}
.code-form .btn{cursor:pointer}
.form-error{color:oklch(55% .18 25)}
footer{display:flex;flex-direction:column;align-items:center;gap:.75rem;border-top:1px solid var(--border-soft);border-bottom:1px solid var(--border-soft);padding:1rem 1.25rem;text-align:center}
footer p{font-size:12px;color:var(--muted-foreground)}
.footer-links{display:flex;flex-wrap:wrap;justify-content:center;gap:.5rem}
.btn{display:inline-flex;align-items:center;height:1.75rem;padding:0 .625rem;border:1px solid var(--border);background:var(--background);color:var(--foreground);font-size:12px;font-weight:500;white-space:nowrap;text-decoration:none;transition:background-color .15s}
.btn:hover{background:var(--muted)}
.reveal{opacity:0;animation:rise .5s cubic-bezier(.22,1,.36,1) forwards}
.reveal:nth-child(2){animation-delay:.06s}.reveal:nth-child(3){animation-delay:.12s}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.reveal{animation:none;opacity:1}}
@media(min-width:640px){.bar{padding:.875rem 2rem}section{padding:2rem}footer{flex-direction:row;justify-content:space-between;padding:1rem 2rem;text-align:left}h1{font-size:2rem}}`;

interface PageMetadata {
  readonly title: string;
  readonly path: string;
}

function page(metadata: PageMetadata, body: string, status: number = 200): Response {
  const pageUrl = new URL(metadata.path, SITE_METADATA.origin).toString();
  const socialImageUrl = new URL(SITE_METADATA.socialImage.path, SITE_METADATA.origin).toString();
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${metadata.title}</title><meta name="description" content="${SITE_METADATA.description}"><meta name="theme-color" content="${SITE_METADATA.themeColor}"><link rel="canonical" href="${pageUrl}"><link rel="icon" href="${SITE_METADATA.icons.favicon}"><link rel="icon" type="image/png" sizes="32x32" href="${SITE_METADATA.icons.large}"><link rel="icon" type="image/png" sizes="16x16" href="${SITE_METADATA.icons.small}"><link rel="apple-touch-icon" sizes="180x180" href="${SITE_METADATA.icons.appleTouch}"><link rel="manifest" href="${SITE_METADATA.manifestPath}"><meta property="og:type" content="${SITE_METADATA.openGraphType}"><meta property="og:site_name" content="${SITE_METADATA.name}"><meta property="og:title" content="${metadata.title}"><meta property="og:description" content="${SITE_METADATA.description}"><meta property="og:url" content="${pageUrl}"><meta property="og:image" content="${socialImageUrl}"><meta property="og:image:alt" content="${SITE_METADATA.socialImage.alt}"><meta property="og:image:width" content="${SITE_METADATA.socialImage.width}"><meta property="og:image:height" content="${SITE_METADATA.socialImage.height}"><meta name="twitter:card" content="${SITE_METADATA.twitterCard}"><meta name="twitter:title" content="${metadata.title}"><meta name="twitter:description" content="${SITE_METADATA.description}"><meta name="twitter:image" content="${socialImageUrl}"><style>${STYLE}</style></head><body><div class="frame">${body}</div></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

function bar(): string {
  return `<div class="bar reveal"><a class="brand" href="https://makarima.xyz">m<em>T</em>unnel</a><nav aria-label="Primary navigation"><a href="https://makarima.xyz/docs">docs</a><a href="https://github.com/zulfaza/mtunnel" rel="noreferrer" target="_blank">github</a></nav></div>`;
}

function footer(): string {
  return `<footer class="reveal"><p>Copyright © 2026 mTunnel</p><div class="footer-links"><a class="btn" href="https://makarima.xyz/docs">Docs</a><a class="btn" href="https://makarima.xyz/terms">Terms</a><a class="btn" href="https://github.com/zulfaza/mtunnel" rel="noreferrer" target="_blank">GitHub</a></div></footer>`;
}

export function previewCodePage(invalid: boolean): Response {
  const error = invalid ? `<p class="form-error">Incorrect access code.</p>` : "";
  return page(
    { title: "Protected preview — mTunnel", path: "/" },
    bar() +
      `<section class="grow reveal"><h2>Protected preview</h2><h1>Access code required</h1><p>This preview is protected. Enter the access code you received to continue.</p><form method="post" class="code-form"><input name="code" type="password" aria-label="Access code" autocomplete="off" required autofocus><button class="btn" type="submit">Unlock</button></form>${error}</section>` +
      footer(),
    401,
  );
}

export function errorPage(status: number, code: string, detail: string): Response {
  return page(
    { title: `${status} — mTunnel`, path: "/" },
    bar() +
      `<section class="grow reveal"><h2>Error</h2><h1 class="error-status">${status}</h1><p>${detail}</p><small class="error-code">${code}</small></section>` +
      footer(),
    status,
  );
}
