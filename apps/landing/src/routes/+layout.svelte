<script lang="ts">
  import "@tunnel/assets/tokens.css";
  import "$lib/site.css";

  let { children } = $props();
</script>

<div class="frame">
  <div class="bar reveal">
    <a class="brand" href="/">m<em>T</em>unnel</a>
    <nav aria-label="Primary navigation">
      <a href="/docs">docs</a>
      <a class="nav-cta" href="https://app.makarima.xyz">dashboard</a>
    </nav>
  </div>

  {@render children()}

  <footer class="reveal">
    <p>Copyright © {new Date().getFullYear()} mTunnel</p>
    <div class="footer-links">
      <a class="btn" href="/docs">Docs</a><a class="btn" href="/terms">Terms</a><a class="btn" href="https://github.com/zulfaza/mtunnel" rel="noreferrer" target="_blank">GitHub</a>
    </div>
  </footer>
</div>
