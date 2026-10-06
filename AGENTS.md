## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm (Nix devShell via direnv `use flake`: nodejs_22 + pnpm; `engine-strict=true`)
- **Add-ons**: prettier, vitest, mdsvex, ai-tools

## Stack & Wiring

- SvelteKit 2 + Svelte 5 scaffold (`sv create` minimal TS; recreate command in README).
- **There is no `svelte.config.js`** — compiler options, mdsvex preprocessing, extensions, and adapter are all configured inside `vite.config.ts` via `sveltekit()`.
- Runes mode is **forced on** for all project code (`compilerOptions.runes: true`). Legacy Svelte syntax (`export let`, `$:`) will fail — use `$state`/`$derived`/`$effect`/`props`.
- mdsvex registers `.md` and `.svx` as Svelte component extensions; a `.md` file placed under `src/` compiles as a component.
- `preprocess: [vitePreprocess(), mdsvex(...)]` in `vite.config.ts` — required for `<style lang="scss">` (sass installed); project style is SCSS with nesting, but keep `$vars` out of `.svelte` style blocks (the svelte-autofixer compiles raw and rejects them; svelte-check honors scss).
- Prettier config is minimal (`prettier.config.js`): `printWidth: 120` + svelte plugin/override only — defaults apply (spaces, double quotes); coding `*.json` files are written in this same style by the PUT handler via prettier `format()`.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm preview`
- `pnpm check` — `svelte-kit sync` + svelte-check (must pass clean; currently 0 errors/warnings)
- `pnpm lint` (prettier --check) / `pnpm format`
- `pnpm test` — runs all vitest projects once (`test:unit` is the watch mode)
- Single test: `pnpm test:unit --run <path/to/file.spec.ts>` (add `-t "<test name>"`, or `--project=server` to skip the browser project)
- `pnpm verify` — re-verifies all coding files against their sources and writes `coding/progress.json` (exit 1 on failures)

Vitest splits into two projects (see `vite.config.ts`):

- `client` — component tests matching `src/**/*.svelte.{test,spec}.ts`, run headless in Chromium via `@vitest/browser-playwright` (browser binaries come from `pnpm exec playwright install chromium`, which downloads into `~/.cache/ms-playwright`; without them the client project fails with "Executable doesn't exist")
- `server` — all other `*.test.ts`/`*.spec.ts` in `src/`, node environment; `src/lib/server/**` is excluded from client
- `expect.requireAssertions: true` — a test with no assertions fails
- UI tests live in `src/tests/` (`*.svelte.spec.ts`): route pages cannot be tested colocated, because SvelteKit reserves every `+`-prefixed file name in `src/routes/` (`+page.svelte.spec.ts` breaks the build). `src/tests/fixtures.ts` holds the catalog fixture plus `resetArticles()`/`seedArticle()` for the RxDB store, and `src/tests/ColorProvider.svelte` is the `render()` wrapper that supplies the `useColors()` context (the real `+layout.svelte` cannot be used as wrapper: its inline `<svelte:head>` script breaks when mounted repeatedly).
- Browser-test gotchas: tests run inside Chromium, so `document.querySelector` is available for class/count assertions; vitest locators have no `page.locator(css)` and no `page.getByLabel` (use `getByLabelText`, `getByRole`, `getByText(...).first()`); `.element()` does not poll — await `expect.element(...).toBeInTheDocument()` first for anything that arrives asynchronously (RxDB loads, autosave, version counters).

## coding_source (read-only)

- `coding_source/` holds raw data to be coded (e.g. per-newspaper `.txt` corpora). Each folder has an `.INSTRUCTIONS.md` with the exact task instructions — always read it first; if it's empty, ask the user.
- Edits to `coding_source/` are **denied** in `opencode.jsonc`. Treat the whole directory as read-only input.

## Coding environment

- Coding lives in `coding/<folder>/<source-basename>.json`, mirroring `coding_source/` (e.g. `coding/test/spd 1.json` for `coding_source/test/spd 1.txt`), typed by `src/lib/coding/types.ts`:

  ```json
  {
    "source": "test/spd 1.txt",
    "codes": [
      {
        "device": "847c4079-1958-49fe-92e8-c7547308be18",
        "line": 8,
        "endLine": 9,
        "range": [0, 91],
        "excerpt": "Anke Hennig, [...] Sprecherin:",
        "note": "optional"
      }
    ]
  }
  ```

- `CodeEntry`/`CodingFile` are zod schemas (`codeEntrySchema`/`codingFileSchema`) in `src/lib/coding/types.ts`; `parseCodingJson` parses through them. Entries reference frame devices by `device` UUID only; a `code` label string is the legacy form for folders without a catalog (an entry needs one or the other). The UI's display label (`2.1 Name`) is derived at load time by `toCodingView()` in `src/lib/server/coding/store.ts` from the catalog — it is never stored in coding files.
- Frame-device catalogs live in `coding/<folder>/.INSTRUCTIONS.json` (e.g. `coding/test/.INSTRUCTIONS.json`), validated by `instructionsSchema` in `src/lib/coding/instructions.ts` (recursive devices with `id` (UUID v4, minted once, never changed), `name`, `kind: device|element`, optional `note`/`rule`, `examples[]`, `children`). Numeric codes (`1.2.3`) are NEVER stored — they are derived from tree position via `codeIndex()`/`idByCode()`. Edit `name`/`rule`/`examples` freely; keep every `id` stable. `coding_add` refuses entries without a catalog-registered `device` (and refuses any `code` label) whenever the folder has such a catalog.
- `line` is 1-based; `range` is `[start, end)` where start offsets are within `line` and end offsets are within the optional `endLine` (defaults to `line`, so entries may cross line breaks). Overlapping entries are allowed. Excerpt ellipsis uses the literal `[...]` mechanism: first segment must start exactly at `range[0]`, last segment must end exactly at `range[1]`, segments appear in order with ≥1 omitted char between them; without `[...]` the excerpt must equal the span verbatim. Enforced by `src/lib/coding/verify.ts`.
- `.opencode/tools/coding.ts` exposes `coding_find` (exact substring → indexed 1-based line/col offsets, mtime-cached), `coding_add` (validates, computes the excerpt itself, appends, echoes the line/span back), and `coding_remove` (drops one entry by 0-based index). These tools are the sanctioned way to discover offsets and mutate coding files — they keep `coding_source/` untouched and refuse non-verifying entries.
- After editing any coding file run `pnpm verify` — writes the generated `coding/progress.json` (prettier-ignored) and lists failures. `src/lib/server/coding/verify.test.ts` additionally asserts every coding file passes (part of `pnpm test:unit --run --project=server`).
- UI: `/` = dashboard (per-folder list, status chips; links to `/colors`); `/text/<folder>/<name>` = the coding page — a **CodeMirror 6** editor (`@codemirror/view`/`@codemirror/state` + `src/lib/coding/code-mark.ts` decorations) showing the source with each coded range decorated, hover popups per entry, and the frame-device catalog in the aside (per-device counts, leaf clicks arm device selection, hover dims unrelated marks). Entries are added on `mouseup` only (the update listener fires per mousemove during drags). `/colors` = color-customization screen (theme source + chroma/tone) with live token/marker previews. The catalog sidebar is the shared `src/lib/coding/CatalogTree.svelte` component (Melt UI `Tree`; props `catalog`, `counts` keyed by catalog id or `null` for server counts, `selected`, `styleFor`, `onpick`, `onhover`). Loads go through `src/lib/server/coding/store.ts` (node `fs`, per request).
- Server: `@sveltejs/adapter-node` (no SSG) — `pnpm preview` = `node build`. `PUT /api/coding/[folder]/[name]` verifies the full submitted `CodingFile` (`verifyCoding` → `EntryError[]`, 422 on any failure) and writes prettier-formatted JSON. Client edits go through RxDB (`rxdb` + Dexie, `src/lib/client/coding-db.ts`): server entries win on load, local edits are `dirty: true` until saved via `pushSource`; entry doc id = `entryId(source, entry)` from `src/lib/coding/edit.ts`.
- Color single source: `src/lib/coding/prefs.svelte.ts` exports `ColorPrefs` (`themeSource`/`chromaAdj`/`toneAdj` runes, persisted to `localStorage`). It is created once per client in `+layout.svelte` via `provideColors()` (which also drives the global CSS vars from `prefs.tokens`) and read anywhere via `useColors()` context — `/text` and `/colors` feed `prefs.options` into `buildPalette`, and the dashboard `.qdc` export passes the same options to `toQdc`, so one control re-tints the whole app. Instantiated per layout mount (no module singleton) to stay SSR-safe.
- Gotcha: Vite 8's build-time `import.meta.glob` does **not** match dotfiles like `.INSTRUCTIONS.md` (dev/vitest does), so instructions files cannot be mdsvex-rendered via glob into the UI; read them from disk if needed.
- Dedicated `coding` agent (`.opencode/agent/coding.md`) runs the classification loop autonomously: reads only the assigned `.INSTRUCTIONS.md`, `.INSTRUCTIONS.json` (device catalog) + `.txt`, adds entries one by one via the `coding_*` tools (always with the matching `device` UUID), then re-checks the whole coding file; never edits, browses, or runs git itself. Select via Tab in the TUI or `opencode run --agent coding "<task>"`.

## Svelte MCP

Svelte MCP server is available (via `@sveltejs/opencode` plugin). Use `list-sections` → `get-documentation` for Svelte 5/SvelteKit questions, and MUST run `svelte-autofixer` on any written `.svelte` code until clean. Skip `playground-link` for code written into this project.
