<script lang="ts">
  import { SITE_METADATA } from "$lib/site-metadata";

  let { title, path, robots }: { title: string; path: string; robots?: string } = $props();

  const pageUrl = $derived(new URL(path, SITE_METADATA.origin).toString());
  const socialImageUrl = new URL(SITE_METADATA.socialImage.path, SITE_METADATA.origin).toString();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={SITE_METADATA.description} />
  {#if robots !== undefined}<meta name="robots" content={robots} />{/if}
  <meta name="theme-color" content={SITE_METADATA.themeColor} />
  <link rel="canonical" href={pageUrl} />
  <link rel="icon" href={SITE_METADATA.icons.favicon} />
  <link rel="icon" type="image/png" sizes="32x32" href={SITE_METADATA.icons.large} />
  <link rel="icon" type="image/png" sizes="16x16" href={SITE_METADATA.icons.small} />
  <link rel="apple-touch-icon" sizes="180x180" href={SITE_METADATA.icons.appleTouch} />
  <link rel="manifest" href={SITE_METADATA.manifestPath} />
  <meta property="og:type" content={SITE_METADATA.openGraphType} />
  <meta property="og:site_name" content={SITE_METADATA.name} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={SITE_METADATA.description} />
  <meta property="og:url" content={pageUrl} />
  <meta property="og:image" content={socialImageUrl} />
  <meta property="og:image:alt" content={SITE_METADATA.socialImage.alt} />
  <meta property="og:image:width" content={String(SITE_METADATA.socialImage.width)} />
  <meta property="og:image:height" content={String(SITE_METADATA.socialImage.height)} />
  <meta name="twitter:card" content={SITE_METADATA.twitterCard} />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={SITE_METADATA.description} />
  <meta name="twitter:image" content={socialImageUrl} />
</svelte:head>
