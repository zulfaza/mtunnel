<script lang="ts">
  import { page } from "$app/state";
  import SiteHead from "$lib/SiteHead.svelte";
</script>

<SiteHead title={`${page.status} — mTunnel`} path="/" />

<section class="grow reveal">
  <h2>Error</h2>
  <h1 class="error-status">{page.status}</h1>
  <p>{page.error?.message ?? "This page does not exist."}</p>
  <small class="error-code">{page.status === 404 ? "not_found" : "error"}</small>
</section>
