<script lang="ts">
  import CopyButton from "$lib/CopyButton.svelte";
  import SiteHead from "$lib/SiteHead.svelte";
  import { SITE_METADATA } from "$lib/site-metadata";

  const USE_COMMANDS = ["mt login", "mt http 3000", "mt http 3000 --name demo"].join("\n");
</script>

<SiteHead {...SITE_METADATA.pages.home} />

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
      <CopyButton text={USE_COMMANDS} />
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
