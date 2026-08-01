<script lang="ts">
  let { text, label = "Copy commands" }: { text: string; label?: string } = $props();

  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    copied = true;
    window.setTimeout(() => (copied = false), 1500);
  }
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && (copied = false)} />

<button class:done={copied} class="copy" type="button" aria-label={label} onclick={copy}>
  {copied ? "✓" : "⧉"}
</button>
