<svelte:head>
  <title>mTunnel — tunnels for local development</title>
  <meta
    name="description"
    content="A small, self-hosted development tunnel for exposing localhost through Cloudflare."
  />
  <meta name="theme-color" content="#fbfaf8" />
  <link rel="icon" href="/favicon.ico" />
</svelte:head>

<script lang="ts">
  let copied = false;

  async function copyCommands() {
    await navigator.clipboard.writeText(
      "curl https://makarima.xyz/install.sh | sh\nmt login\nmt http 3000\nmt http 3000 --name demo",
    );
    copied = true;
    window.setTimeout(() => (copied = false), 1500);
  }
</script>

<svelte:window on:keydown={(event) => event.key === "Escape" && (copied = false)} />

<div class="frame">
  <div class="bar reveal">
    <a class="brand" href="/">m<em>T</em>unnel</a>
    <nav aria-label="Primary navigation">
      <a href="/docs">docs</a>
      <a href="https://app.makarima.xyz/login">login</a>
      <a href="https://app.makarima.xyz/register">register</a>
    </nav>
  </div>

  <header class="hero hero-split reveal">
    <div>
      <h1 class="hero-title">Your localhost, <span class="hero-title-accent">on the internet.</span></h1>
      <p class="lede">
        Share your local server with one command. Sign in with Google, get a stable subdomain, and let
        idle tunnels shut down automatically.
      </p>
    </div>
    <figure class="viz" aria-hidden="true">
      <svg viewBox="0 0 320 332" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <g transform="rotate(-14 160 166)">
          <circle class="glb out" cx="160" cy="166" r="140" />
          <ellipse class="glb" cx="160" cy="166" rx="140" ry="36" />
          <ellipse class="glb" cx="160" cy="102" rx="124" ry="31" />
          <ellipse class="glb" cx="160" cy="230" rx="124" ry="31" />
          <ellipse class="glb" cx="160" cy="58" rx="89" ry="22" />
          <ellipse class="glb" cx="160" cy="274" rx="89" ry="22" />
          <ellipse class="mer" cx="160" cy="166" rx="140" ry="140" />
          <ellipse class="mer mer-one" cx="160" cy="166" rx="140" ry="140" />
          <ellipse class="mer mer-two" cx="160" cy="166" rx="140" ry="140" />
          <ellipse class="mer mer-three" cx="160" cy="166" rx="140" ry="140" />
          <ellipse class="mer mer-four" cx="160" cy="166" rx="140" ry="140" />
          <g class="network-spin">
            <path class="arc" d="M62 96Q112 66 160 52" />
            <path class="arc" d="M160 52Q192 78 244 84" />
            <path class="arc dsh" d="M244 84Q292 116 286 160" />
            <path class="arc" d="M286 160Q294 212 254 246" />
            <path class="arc" d="M254 246Q216 292 160 286" />
            <path class="arc dsh" d="M160 286Q102 282 70 238" />
            <path class="arc" d="M70 238Q34 208 40 170" />
            <path class="arc" d="M40 170Q38 122 62 96" />
            <path class="arc" d="M62 96Q108 128 148 140" />
            <path class="arc" d="M148 140Q182 168 210 190" />
            <path class="arc" d="M210 190Q236 214 254 246" />
            <path class="arc" d="M148 140Q198 118 244 84" />
            <path class="arc" d="M108 190Q126 166 148 140" />
            <path class="arc" d="M70 238Q86 212 108 190" />
            <path class="arc" d="M205 120Q178 130 148 140" />
            <path class="arc dsh" d="M205 120Q248 138 286 160" />
            <circle class="nd" cx="62" cy="96" r="4" />
            <circle class="nd delayed-half" cx="160" cy="52" r="3" />
            <circle class="nd delayed-one" cx="244" cy="84" r="3.5" />
            <circle class="nd delayed-one-half" cx="286" cy="160" r="3" />
            <circle class="nd delayed-two" cx="254" cy="246" r="3.5" />
            <circle class="nd delayed-two-half" cx="160" cy="286" r="3" />
            <circle class="nd delayed-three" cx="70" cy="238" r="4" />
            <circle class="nd delayed-three-half" cx="40" cy="170" r="3" />
            <circle class="nd delayed-one-two" cx="148" cy="140" r="4.5" />
            <circle class="nd delayed-two-two" cx="210" cy="190" r="3" />
            <circle class="nd delayed-three-two" cx="108" cy="190" r="2.5" />
            <circle class="nd delayed-eight" cx="205" cy="120" r="2.5" />
          </g>
        </g>
      </svg>
    </figure>
  </header>

  <div class="cols reveal">
    <section id="install">
      <h2>Install</h2>
      <div class="code"><i>$ </i><b>curl https://makarima.xyz/install.sh | sh</b></div>
      <p>Drops a single static binary in <code>~/.local/bin</code> (Linux &amp; macOS, amd64 &amp; arm64). No runtime dependencies.</p>
    </section>
    <section id="use">
      <h2>Use</h2>
      <div class="code">
        <div class="command-row"><span><i>$ </i><b>mt login</b></span><i># sign in with Google</i></div>
        <div class="command-row"><span><i>$ </i><b>mt http 3000</b></span><i># expose localhost:3000</i></div>
        <div class="command-row"><span><i>$ </i><b>mt http 3000 --name demo</b></span><i># stable subdomain</i></div>
        <button class:done={copied} class="copy" type="button" aria-label="Copy commands" on:click={copyCommands}>
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <ul>
        <li><code>mt status</code> — connection state and public URL</li>
        <li><code>mt domain add &lt;hostname&gt; --name &lt;tunnel&gt;</code> — route a custom domain to a tunnel</li>
        <li><code>mt org create &lt;name&gt;</code> — create and switch to a new organization</li>
        <li><code>mt update</code> — self-update to the latest release</li>
      </ul>
      <p>Full command reference and feature guide in the <a href="/docs">docs</a>.</p>
    </section>
  </div>

  <footer class="reveal">
    <p>Copyright © {new Date().getFullYear()} mTunnel</p>
    <div class="footer-links">
      <a class="btn" href="/docs">Docs</a><a class="btn" href="/terms">Terms</a><a class="btn" href="https://github.com/zulfaza/mtunnel" rel="noreferrer" target="_blank">GitHub</a>
    </div>
  </footer>
</div>

<style>
  @font-face { font-family: "Geist Mono"; font-display: swap; font-style: normal; font-weight: 100 900; src: url("https://cdn.jsdelivr.net/fontsource/fonts/geist-mono:vf@latest/latin-wght-normal.woff2") format("woff2-variations"); }
  :global(*) { box-sizing: border-box; margin: 0; }
  :global(html) { scroll-behavior: smooth; }
  :global(body) { min-height: 100svh; background-color: var(--background); background-image: linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to bottom, var(--grid) 1px, transparent 1px); background-size: 100% 2.75rem, 2.75rem 100%; color: var(--foreground); font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; line-height: 1.75rem; -webkit-font-smoothing: antialiased; }
  :global(:root) { --background: oklch(98.5% .002 84.58); --foreground: oklch(20.5% .01 33.41); --muted: oklch(96.5% .004 84.58); --muted-foreground: oklch(52% .012 35.14); --border: oklch(89% .005 56.44); --border-soft: color-mix(in oklab, var(--border) 80%, transparent); --grid: color-mix(in oklab, var(--border) 72%, transparent); --accent-text: oklch(45% .09 150); }
  .frame { background: var(--background); border-left: 1px solid var(--border-soft); border-right: 1px solid var(--border-soft); display: flex; flex-direction: column; margin: 0 auto; max-width: 72rem; min-height: 100svh; width: 100%; }
  .bar { align-items: center; border-bottom: 1px solid var(--border-soft); display: flex; gap: 1rem; justify-content: space-between; padding: .875rem 1.25rem; }
  .brand { color: var(--foreground); font-size: 14px; font-weight: 600; letter-spacing: -.01em; text-decoration: none; }
  .brand em { color: var(--accent-text); font-style: normal; }
  nav { display: flex; flex-wrap: wrap; gap: 1rem; }
  nav a { border-bottom: 1px solid transparent; color: var(--muted-foreground); font-size: 13px; padding-bottom: .125rem; text-decoration: none; transition: color .15s, border-color .15s; }
  nav a:hover { border-color: color-mix(in oklab, var(--foreground) 40%, transparent); color: var(--foreground); }
  .hero { border-bottom: 1px solid var(--border-soft); padding: 2.5rem 1.25rem 2.75rem; }
  h1 { font-size: 1.625rem; font-weight: 500; letter-spacing: -.01em; line-height: 1.3; max-width: 38rem; }
  .hero-title { font-size: 2rem; max-width: 42rem; }
  .hero-title::before { animation: route-marker 2.4s ease-in-out infinite; color: var(--muted-foreground); content: "↗"; display: inline-block; font-size: .65em; margin-right: .5rem; transform: translateY(-.1em); }
  .hero-title-accent { color: var(--accent-text); display: inline-block; position: relative; }
  .hero-title-accent::after { animation: draw-route .7s .25s cubic-bezier(.22, 1, .36, 1) both; background: linear-gradient(90deg, var(--accent-text), transparent); bottom: -.08em; content: ""; height: 1px; left: 0; position: absolute; right: 0; transform-origin: left; }
  .lede { color: var(--muted-foreground); font-size: 14px; margin-top: 1rem; max-width: 38rem; }
  .cols { display: flex; flex: 1; flex-direction: column; }
  section { padding: 1.75rem 1.25rem 2.25rem; scroll-margin-top: 1rem; }
  section + section { border-top: 1px solid var(--border-soft); }
  h2 { color: var(--muted-foreground); font-size: 11px; font-weight: 500; letter-spacing: .16em; text-transform: uppercase; }
  section p { color: var(--muted-foreground); font-size: 13px; line-height: 1.5rem; margin-top: 1rem; max-width: 38rem; }
  section a { border-bottom: 1px solid color-mix(in oklab, var(--accent-text) 40%, transparent); color: var(--accent-text); text-decoration: none; }
  code { background: var(--muted); border: 1px solid var(--border-soft); font-family: inherit; font-size: 12px; padding: .05rem .375rem; white-space: nowrap; }
  .code { background: var(--muted); border: 1px solid var(--border-soft); font-feature-settings: "liga" 0, "calt" 0; font-size: 13px; font-variant-ligatures: none; line-height: 1.9; margin-top: 1rem; overflow: hidden; padding: 1rem 3.5rem 1rem 1.25rem; position: relative; }
  .code b { color: var(--accent-text); font-weight: 400; white-space: pre; }
  .code i { color: var(--muted-foreground); font-style: normal; user-select: none; white-space: pre; }
  .command-row { display: flex; flex-direction: column; }
  .command-row + .command-row { margin-top: .625rem; }
  .command-row > i { order: -1; white-space: normal; }
  .copy { align-items: center; background: var(--background); border: 1px solid var(--border); color: var(--muted-foreground); cursor: pointer; display: inline-flex; font-family: inherit; font-size: 15px; height: 1.625rem; justify-content: center; padding: 0; position: absolute; right: .5rem; top: .5rem; transition: background-color .15s, color .15s; width: 1.625rem; }
  .copy:hover { background: var(--muted); color: var(--foreground); }
  .copy.done { border-color: color-mix(in oklab, var(--accent-text) 40%, var(--border)); color: var(--accent-text); }
  ul { border-top: 1px solid var(--border-soft); list-style: none; margin-top: 1rem; padding: 0; }
  li { align-items: baseline; border-bottom: 1px solid var(--border-soft); color: var(--muted-foreground); display: flex; flex-wrap: wrap; font-size: 13px; gap: .375rem .75rem; line-height: 1.5rem; padding: .625rem 0; }
  li code { color: var(--foreground); }
  footer { align-items: center; border-bottom: 1px solid var(--border-soft); border-top: 1px solid var(--border-soft); display: flex; flex-direction: column; gap: .75rem; padding: 1rem 1.25rem; text-align: center; }
  footer p { color: var(--muted-foreground); font-size: 12px; }
  .footer-links { display: flex; flex-wrap: wrap; gap: .5rem; justify-content: center; }
  .btn { background: var(--background); border: 1px solid var(--border); color: var(--foreground); display: inline-flex; font-size: 12px; font-weight: 500; height: 1.75rem; padding: 0 .625rem; text-decoration: none; white-space: nowrap; }
  .hero-split { display: flex; flex-direction: column; }
  .viz { align-self: center; display: block; margin-bottom: 1.5rem; order: -1; width: min(13rem, 70vw); }
  .viz svg { display: block; height: auto; width: 100%; }
  .viz .network-spin { animation: network-spin 18s linear infinite; transform-origin: 160px 166px; }
  .viz .glb { fill: none; stroke: color-mix(in oklab, var(--foreground) 20%, transparent); }
  .viz .out { stroke: color-mix(in oklab, var(--foreground) 42%, transparent); }
  .viz .mer { animation: mer 18s linear infinite; fill: none; stroke: color-mix(in oklab, var(--foreground) 20%, transparent); }
  .viz .arc { fill: none; stroke: color-mix(in oklab, var(--foreground) 34%, transparent); }
  .viz .dsh { stroke-dasharray: 1.5 5; stroke-linecap: round; }
  .viz .nd { animation: pulse 4s ease-in-out infinite; fill: var(--foreground); }
  .delayed-half { animation-delay: -.5s !important; }
  .delayed-one { animation-delay: -1s !important; }
  .delayed-one-half { animation-delay: -1.5s !important; }
  .delayed-two { animation-delay: -2s !important; }
  .delayed-two-half { animation-delay: -2.5s !important; }
  .delayed-three { animation-delay: -3s !important; }
  .delayed-three-half { animation-delay: -3.5s !important; }
  .delayed-one-two { animation-delay: -1.2s !important; }
  .delayed-two-two { animation-delay: -2.2s !important; }
  .delayed-three-two { animation-delay: -3.2s !important; }
  .delayed-eight { animation-delay: -.8s !important; }
  .mer-one { animation-delay: -3.6s !important; }
  .mer-two { animation-delay: -7.2s !important; }
  .mer-three { animation-delay: -10.8s !important; }
  .mer-four { animation-delay: -14.4s !important; }
  @keyframes mer { 0% { animation-timing-function: ease-in; rx: 140px; } 50% { animation-timing-function: ease-out; rx: 1px; } 100% { rx: 140px; } }
  @keyframes network-spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
  @keyframes route-marker { 0%, 100% { opacity: .45; transform: translate(0, -.1em); } 50% { opacity: 1; transform: translate(.12em, -.22em); } }
  @keyframes draw-route { from { opacity: 0; transform: scaleX(0); } to { opacity: 1; transform: scaleX(1); } }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .reveal { animation: rise .5s cubic-bezier(.22, 1, .36, 1) forwards; opacity: 0; }
  .reveal:nth-child(2) { animation-delay: .06s; }
  .reveal:nth-child(3) { animation-delay: .12s; }
  @media (prefers-color-scheme: dark) { :global(:root) { --background: oklch(21.5% .009 33.41); --foreground: oklch(94% .004 84.58); --muted: oklch(29% .008 33.41); --muted-foreground: oklch(72% .007 70.08); --border: oklch(100% 0 0/.1); --accent-text: oklch(80% .1 150); } }
  @media (prefers-reduced-motion: reduce) { .reveal, .viz *, .hero-title::before, .hero-title-accent::after { animation: none !important; opacity: 1; } }
  @media (min-width: 640px) { .bar { padding: .875rem 2rem; } .hero { padding: 3.25rem 2rem 3.5rem; } section { padding: 2rem; } footer { flex-direction: row; justify-content: space-between; padding: 1rem 2rem; text-align: left; } h1 { font-size: 2rem; } .hero-title { font-size: 2.75rem; } .command-row { display: grid; gap: 2rem; grid-template-columns: max-content max-content; } .command-row + .command-row { margin-top: 0; } .command-row > i { order: initial; white-space: pre; } }
  @media (min-width: 1024px) { .hero-split { align-items: center; display: grid; gap: 2rem; grid-template-columns: minmax(0, 38rem) auto; } .viz { align-self: auto; justify-self: end; margin: 0 1rem 0 0; order: initial; width: 19rem; } .cols { align-items: stretch; display: grid; grid-template-columns: 1fr 1fr; } .cols section + section { border-left: 1px solid var(--border-soft); border-top: 0; } }
</style>
