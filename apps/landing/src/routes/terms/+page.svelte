<script lang="ts">
  import SiteHead from "$lib/SiteHead.svelte";
  import { SITE_METADATA } from "$lib/site-metadata";
</script>

<SiteHead {...SITE_METADATA.pages.terms} robots="noindex, nofollow" />

<header class="hero reveal">
  <h1>Terms of Service</h1>
  <p class="lede">
    mTunnel is a development tunnel service that exposes a local HTTP server on the internet. By
    creating an account or opening a tunnel, you agree to these terms.
  </p>
</header>

<div class="grow reveal">
  <section>
    <h2>The service</h2>
    <p>
      The <code>mt</code> CLI connects your machine to Cloudflare's edge and routes public requests on a
      <code>makarima.xyz</code> subdomain (or a custom domain you configure) to a local port you choose.
      The service is intended for development and testing, not for hosting production workloads.
    </p>
  </section>
  <section>
    <h2>Accounts</h2>
    <p>
      You sign in with a Google account through WorkOS. Each account belongs to an organization, which
      owns its tunnels and domains. We store the minimum needed to operate the service: your account and
      organization identifiers, email address, and the tunnels and domains you register. You are
      responsible for activity that happens through your account and tunnels.
    </p>
  </section>
  <section>
    <h2>Acceptable use</h2>
    <p>
      Traffic through your tunnel is your responsibility. Don't use the service to distribute malware,
      phish, infringe copyright, evade network policies you are bound by, or expose services you don't
      have the right to expose. Custom domains may only be added for hostnames you control. We may block
      traffic or close tunnels that abuse the service or burden the network.
    </p>
  </section>
  <section>
    <h2>Availability</h2>
    <p>
      The service is provided on a best-effort basis with no uptime guarantee. Usage limits apply per
      organization (see the <a href="/docs">docs</a>): idle and long-running tunnels are shut down
      automatically, concurrent tunnels and custom domains are capped, and subdomain assignments may
      change unless you use a named tunnel. We may change or discontinue the service at any time.
    </p>
  </section>
  <section>
    <h2>Privacy</h2>
    <p>
      Tunnel traffic passes through Cloudflare and is forwarded to your machine; we do not store request
      or response bodies. Operational logs (connection metadata, error events) are kept only as long as
      needed to run and debug the service.
    </p>
  </section>
  <section>
    <h2>Termination</h2>
    <p>
      You can stop using the service at any time; closing your tunnels and deleting the CLI removes your
      access. We may suspend or terminate accounts that violate these terms.
    </p>
  </section>
  <section>
    <h2>Disclaimer</h2>
    <p>
      The service and the CLI are provided "as is", without warranty of any kind. To the maximum extent
      permitted by law, mTunnel is not liable for damages arising from use of the service, including data
      loss or exposure of services you tunnel.
    </p>
  </section>
  <section>
    <h2>Changes</h2>
    <p>
      We may update these terms; the current version is always at <code>makarima.xyz/terms</code>.
      Continued use after a change means you accept these terms. Questions: open an issue on
      <a href="https://github.com/zulfaza/mtunnel" rel="noreferrer" target="_blank">GitHub</a>.
    </p>
  </section>
</div>
