<svelte:head>
  <title>mtunnel — share local work</title>
  <meta name="description" content="A fast, secure tunnel for sharing local work." />
</svelte:head>

<script lang="ts">
  import logo from "@tunnel/assets/logo-512x512.png";
</script>

<main>
  <nav aria-label="Primary navigation">
    <a class="brand" href="/"><img src={logo} alt="" /> mtunnel</a>
    <div>
      <a href="#pricing">Pricing</a>
      <a href="https://app.makarima.xyz">Dashboard</a>
    </div>
  </nav>

  <section class="hero">
    <p class="eyebrow">Local development, publicly reachable</p>
    <h1>Share what you are building.</h1>
    <p class="lead">mtunnel creates a secure public URL for your local service in one command.</p>
    <div class="actions">
      <a class="button" href="https://app.makarima.xyz">Open dashboard</a>
      <a class="text-link" href="#install">Install mtunnel</a>
    </div>
  </section>

  <section class="features" aria-label="Features">
    <article><h2>Fast by default</h2><p>Stream requests directly between your local service and the edge.</p></article>
    <article><h2>Preview assets</h2><p>Publish a directory and share a short-lived, hosted preview.</p></article>
    <article><h2>Own your domain</h2><p>Point a custom hostname at the tunnel your team already uses.</p></article>
  </section>

  <section class="install" id="install">
    <div><p class="eyebrow">Install</p><h2>Start in seconds.</h2><p>Authenticate once, then point mtunnel at any local port.</p></div>
    <pre><code>curl -fsSL https://makarima.xyz/install.sh | sh
mt login
mt http 3000</code></pre>
  </section>

  <section class="pricing" id="pricing">
    <p class="eyebrow">Pricing</p><h2>Simple while we are in preview.</h2><p>Core tunnelling and preview assets are available during the public preview.</p>
  </section>

  <footer><span>© {new Date().getFullYear()} mtunnel</span><a href="https://api.makarima.xyz/health">API status</a></footer>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: var(--surface); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  main { margin: 0 auto; max-width: 70rem; padding: 1.5rem; }
  nav, footer { align-items: center; display: flex; justify-content: space-between; }
  nav a, footer a { color: var(--text-muted); text-decoration: none; }
  nav div { display: flex; gap: 1.5rem; }
  .brand { align-items: center; color: var(--text); display: inline-flex; font-weight: 750; gap: .55rem; }
  .brand img { border-radius: .4rem; height: 1.65rem; width: 1.65rem; }
  .hero { max-width: 48rem; padding: 8rem 0 6rem; }
  h1 { font-size: clamp(3rem, 8vw, 6.5rem); letter-spacing: -.07em; line-height: .94; margin: .8rem 0 1.4rem; }
  h2 { letter-spacing: -.03em; margin: 0 0 .7rem; }
  .eyebrow { color: var(--brand); font-size: .8rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .lead { color: var(--text-muted); font-size: 1.25rem; line-height: 1.6; max-width: 38rem; }
  .actions { align-items: center; display: flex; gap: 1.5rem; margin-top: 2rem; }
  .button { background: var(--brand); border-radius: .55rem; color: white; font-weight: 700; padding: .8rem 1.1rem; text-decoration: none; }
  .text-link { color: var(--text); font-weight: 650; }
  .features { display: grid; gap: 1rem; grid-template-columns: repeat(3, 1fr); }
  .features article, .pricing { background: var(--surface-muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; }
  .features p, .pricing p, .install p { color: var(--text-muted); line-height: 1.55; }
  .install { align-items: center; display: grid; gap: 2rem; grid-template-columns: 1fr 1fr; padding: 7rem 0; }
  pre { background: var(--brand-dark); border-radius: var(--radius); color: #efedff; margin: 0; overflow-x: auto; padding: 1.3rem; }
  .pricing { margin-bottom: 5rem; max-width: 35rem; }
  footer { border-top: 1px solid var(--border); color: var(--text-muted); font-size: .9rem; padding: 2rem 0; }
  @media (max-width: 42rem) { .features, .install { grid-template-columns: 1fr; } .hero { padding: 5rem 0; } }
</style>
