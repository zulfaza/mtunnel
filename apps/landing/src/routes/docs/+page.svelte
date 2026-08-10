<script lang="ts">
  import CopyButton from "$lib/CopyButton.svelte";
  import SiteHead from "$lib/SiteHead.svelte";
  import { SITE_METADATA } from "$lib/site-metadata";

  const INSTALL_COMMAND = "curl https://makarima.xyz/install.sh | sh";
  const TUNNEL_COMMANDS = ["mt http 3000", "mt http 3000 --name demo", "mt http api"].join("\n");
  const CONFIG_SAMPLE = `{
  "tunnels": {
    "api":  { "port": 3000 },
    "web":  { "port": 5173, "hostname": "127.0.0.1" }
  }
}`;
  const DOMAIN_COMMANDS = [
    "mt domain add dev.example.com --name demo",
    "mt domain detail dev.example.com",
    "mt domain verify dev.example.com",
    "mt domain status dev.example.com",
  ].join("\n");
  const ORG_COMMANDS = [
    "mt org list",
    'mt org create "Acme Inc"',
    "mt org use org_123",
    'mt org rename org_123 "Acme Labs"',
    "mt org invite org_123 member@example.com",
    "mt org members org_123",
    "mt org remove-member org_123 om_123",
    "mt org leave org_123",
  ].join("\n");
</script>

<SiteHead {...SITE_METADATA.pages.docs} robots="noindex, nofollow" />

<header class="hero reveal">
  <h1>Docs</h1>
  <p class="lede">
    Everything the <b>mt</b> CLI and the mTunnel edge can do: tunnels, named subdomains, project
    config, custom domains, organizations, and the limits that apply to your organization.
  </p>
</header>

<div class="docs reveal">
  <aside class="toc">
    <h2>On this page</h2>
    <ol>
      <li><a href="#install">Install &amp; update</a></li>
      <li><a href="#auth">Sign in</a></li>
      <li><a href="#tunnels">Tunnels</a></li>
      <li><a href="#config">Config files</a></li>
      <li><a href="#domains">Custom domains</a></li>
      <li><a href="#organizations">Organizations</a></li>
      <li><a href="#limits">Limits</a></li>
      <li><a href="#how">How it works</a></li>
    </ol>
  </aside>

  <div class="docs-body">
    <section id="install">
      <h2>Install &amp; update</h2>
      <div class="code">
        <i>$ </i><b>curl https://makarima.xyz/install.sh | sh</b>
        <CopyButton text={INSTALL_COMMAND} label="Copy install command" />
      </div>
      <p>
        Installs a single static <code>mt</code> binary to <code>~/.local/bin</code> (override with
        <code>INSTALL_DIR</code>). Linux and macOS, amd64 and arm64. <code>mt update</code> re-runs the
        installer to fetch the latest release; <code>mt version</code> prints the installed version.
      </p>
    </section>

    <section id="auth">
      <h2>Sign in</h2>
      <div class="code">
        <i>$ </i><b>mt login</b>
        <CopyButton text="mt login" label="Copy login command" />
      </div>
      <p>
        Starts a WorkOS device-authorization flow: the CLI prints a URL and code, you approve it in the
        browser with your Google account, and tokens are stored in the CLI config. Access tokens refresh
        automatically while a tunnel is running. Each account belongs to an organization, which owns its
        tunnels and domains.
      </p>
    </section>

    <section id="tunnels">
      <h2>Tunnels</h2>
      <div class="code">
        <div class="command-row"><span><i>$ </i><b>mt http 3000</b></span><i># random subdomain</i></div>
        <div class="command-row"><span><i>$ </i><b>mt http 3000 --name demo</b></span><i># stable subdomain</i></div>
        <div class="command-row"><span><i>$ </i><b>mt http api</b></span><i># named tunnel from project config</i></div>
        <CopyButton text={TUNNEL_COMMANDS} />
      </div>
      <p>
        <code>mt http &lt;port&gt;</code> exposes a local port on a <code>*.makarima.xyz</code> subdomain.
        Without <code>--name</code> you get a random name; with it, a stable one you can reconnect to.
        Passing a name instead of a port looks the tunnel up in the nearest
        <code>mtunnel.config.json</code>, which maps tunnel names to a port and optional upstream
        hostname, so a repo can check in its tunnel setup.
      </p>
      <ul>
        <li><code>mt status [tunnel-id]</code> — connection state and public URL</li>
        <li><code>--hostname</code> — local upstream host (default <code>localhost</code>)</li>
        <li><code>--request-timeout</code> — upstream request timeout (default 30s)</li>
        <li><code>--idle-timeout</code> — client-side idle shutdown (default 15m, 0 disables)</li>
      </ul>
    </section>

    <section id="config">
      <h2>Config files</h2>
      <div class="code">
        <b>{"{"}</b><br />
        <b>{'  "tunnels": {'}</b><br />
        <b>{'    "api":  { "port": 3000 },'}</b><br />
        <b>{'    "web":  { "port": 5173, "hostname": "127.0.0.1" }'}</b><br />
        <b>{"  }"}</b><br />
        <b>{"}"}</b>
        <CopyButton text={CONFIG_SAMPLE} label="Copy config sample" />
      </div>
      <p>
        A <code>mtunnel.config.json</code> checked into your repo maps tunnel names to a local port and
        optional upstream hostname. The CLI searches from the working directory upward, so it works from
        any subdirectory. With the example above, <code>mt http api</code> exposes port 3000 as the named
        tunnel <code>api</code> — same stable subdomain every time, no flags to remember.
      </p>
      <p>
        Credentials live separately in the CLI config at <code>~/.config/tunnel/config.json</code> (or
        your OS config dir), written by <code>mt login</code>: the server URL and access/refresh tokens.
        Override the location with <code>--config</code>; never commit this file.
      </p>
    </section>

    <section id="domains">
      <h2>Custom domains</h2>
      <div class="code">
        <i>$ </i><b>mt domain add dev.example.com --name demo</b><br />
        <i>$ </i><b>mt domain detail dev.example.com</b><br />
        <i>$ </i><b>mt domain verify dev.example.com</b><br />
        <i>$ </i><b>mt domain status dev.example.com</b>
        <CopyButton text={DOMAIN_COMMANDS} />
      </div>
      <p>
        <code>mt domain add</code> registers a hostname for a named tunnel and prints the DNS records to
        create: a CNAME pointing at the service and a TXT record proving you control the name.
        <code>mt domain detail</code> prints those records again. Once the records exist,
        <code>mt domain verify</code> checks DNS and provisions the certificate;
        <code>mt domain status</code> shows provisioning progress. <code>mt domain list</code> shows your
        domains with tunnel, status, and last use; <code>mt domain delete</code> removes one.
      </p>
    </section>

    <section id="organizations">
      <h2>Organizations</h2>
      <div class="code">
        <i>$ </i><b>mt org list</b><br />
        <i>$ </i><b>mt org create "Acme Inc"</b><br />
        <i>$ </i><b>mt org use org_123</b><br />
        <i>$ </i><b>mt org invite org_123 member@example.com</b>
        <br /><i>$ </i><b>mt org members org_123</b>
        <CopyButton text={ORG_COMMANDS} />
      </div>
      <p>
        Every account starts in a personal organization. Signing up with a verified work email auto-joins
        an existing organization that already claims that domain; free providers (Gmail, Outlook, etc.)
        never auto-join. <code>mt org create</code> makes a new organization and switches to it;
        <code>mt org list</code> shows every organization you belong to;
        <code>mt org use &lt;id&gt;</code> switches which one subsequent commands (tunnels, domains) act
        on. <code>mt org rename</code>, <code>mt org invite</code>, <code>mt org members</code>,
        <code>mt org remove-member</code>, and <code>mt org leave</code>
        manage membership details. You cannot leave your last organization.
      </p>
    </section>

    <section id="limits">
      <h2>Limits</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Limit</th>
            <th scope="col">Standard</th>
            <th scope="col">Unrestricted</th>
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row">Concurrent tunnels</th><td>3</td><td>Unlimited</td></tr>
          <tr><th scope="row">Custom domains</th><td>1</td><td>Unlimited</td></tr>
          <tr><th scope="row">Idle timeout</th><td>15 minutes</td><td>No timeout</td></tr>
          <tr><th scope="row">Maximum tunnel lifetime</th><td>1 hour</td><td>No timeout</td></tr>
        </tbody>
      </table>
      <p>
        Limits apply per organization. After a tunnel closes, reconnecting with the same
        <code>--name</code> restores the same subdomain.
      </p>
    </section>

    <section id="how">
      <h2>How it works</h2>
      <p>
        The CLI opens a WebSocket to a Cloudflare Worker, which pins each tunnel to its own Durable
        Object. Public requests to your subdomain (or custom domain) hit the Worker, are routed to that
        Durable Object, streamed down the WebSocket to your machine, and the response streams back.
        Request and response bodies are not stored; the edge compresses responses for the browser.
      </p>
      <p>
        Global flags: <code>--server</code> (override server URL), <code>--config</code> (config file
        path), <code>--token</code> (override stored auth), <code>--log-level</code> (debug, info, warn,
        error).
      </p>
    </section>
  </div>
</div>
