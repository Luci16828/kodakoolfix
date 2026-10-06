<script lang="ts">
  import "@fontsource-variable/source-sans-3";
  import "@fontsource-variable/source-serif-4";
  import "material-symbols/rounded.css";
  import favicon from "$lib/assets/favicon.svg";
  import { provideColors } from "$lib/coding/prefs.svelte";

  let { children } = $props();

  // the single color source for the whole app (theme + every marker palette)
  const prefs = provideColors();
  const vars = (t: Record<string, string>) =>
    [
      `--surface: ${t.surface}`,
      `--on-surface: ${t.onSurface}`,
      `--surface-variant: ${t.surfaceVariant}`,
      `--on-surface-variant: ${t.onSurfaceVariant}`,
      `--outline: ${t.outline}`,
      `--primary: ${t.primary}`,
      `--on-primary: ${t.onPrimary}`,
      `--primary-container: ${t.primaryContainer}`,
      `--on-primary-container: ${t.onPrimaryContainer}`,
    ].join("; ");
  const themeCss = $derived(
    [
      `:root { color-scheme: light; --font-sans: 'Source Sans 3 Variable', system-ui, sans-serif; --font-serif: 'Source Serif 4 Variable', Georgia, serif; ${vars(prefs.tokens.light)} }`,
      `:root[data-theme='dark'] { color-scheme: dark; ${vars(prefs.tokens.dark)} }`,
      `body { background: var(--surface); color: var(--on-surface); font-family: var(--font-sans); transition: background 0.2s, color 0.2s; }`,
      `a { color: var(--primary); }`,
    ].join("\n"),
  );

  let chosen = $state<"light" | "dark" | null>(null);
  const theme = $derived(
    chosen ??
      (typeof document === "undefined"
        ? "light"
        : ((document.documentElement.dataset.theme as "light" | "dark" | undefined) ?? "light")),
  );

  function toggleTheme() {
    chosen = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = chosen;
    localStorage.setItem("coding-theme", chosen);
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <!-- prerendered theme pick, applied before first paint -->
  <script>
    const params = new URLSearchParams(location.search);
    document.documentElement.dataset.theme = params.get("theme") ?? localStorage.getItem("coding-theme") ?? "light";
  </script>
  {@html `<style>\n${themeCss}\n</style>`}
</svelte:head>

<button type="button" class="theme-toggle" onclick={toggleTheme} aria-label="switch color theme"
  ><span class="material-symbols-rounded" aria-hidden="true">{theme === "dark" ? "light_mode" : "dark_mode"}</span
  ></button
>

{@render children()}

<style>
  .theme-toggle {
    position: fixed;
    top: 0.6rem;
    right: 0.8rem;
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--outline);
    background: var(--surface-variant);
    color: var(--on-surface-variant);
    border-radius: 999px;
    padding: 0.25rem 0.55rem;
    cursor: pointer;
  }
  .theme-toggle .material-symbols-rounded {
    font-size: 1.15rem;
  }
</style>
