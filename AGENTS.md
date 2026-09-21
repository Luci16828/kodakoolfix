## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm (Nix devShell via direnv `use flake`: nodejs_22 + pnpm; `engine-strict=true`)
- **Add-ons**: prettier, vitest, mdsvex, ai-tools

## Stack & Wiring

- SvelteKit 2 + Svelte 5 scaffold (`sv create` minimal TS; recreate command in README).
- **There is no `svelte.config.js`** — compiler options, mdsvex preprocessing, extensions, and adapter are all configured inside `vite.config.ts` via `sveltekit()`.
- Runes mode is **forced on** for all project code (`compilerOptions.runes: true`). Legacy Svelte syntax (`export let`, `$:`) will fail — use `$state`/`$derived`/`$effect`/`props`.
- mdsvex registers `.md` and `.svx` as Svelte component extensions; a `.md` file placed under `src/` compiles as a component.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm preview`
- `pnpm check` — `svelte-kit sync` + svelte-check (must pass clean; currently 0 errors/warnings)
- `pnpm lint` (prettier --check) / `pnpm format`
- `pnpm test` — runs all vitest projects once (`test:unit` is the watch mode)
- Single test: `pnpm test:unit --run <path/to/file.spec.ts>` (add `-t "<test name>"`, or `--project=server` to skip the browser project)
- `pnpm verify` — re-verifies all coding files against their sources and writes `coding/progress.json` (exit 1 on failures)

Vitest splits into two projects (see `vite.config.ts`):

- `client` — component tests matching `src/**/*.svelte.{test,spec}.ts`, run headless in Chromium via `@vitest/browser-playwright` (Playwright Chromium is only installable via Nix here; without it, full `pnpm test` fails on this project — use `--project=server` to verify node tests)
- `server` — all other `*.test.ts`/`*.spec.ts` in `src/`, node environment; `src/lib/server/**` is excluded from client
- `expect.requireAssertions: true` — a test with no assertions fails

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
  			"code": "speaker-role",
  			"line": 8,
  			"range": [0, 91],
  			"excerpt": "Anke Hennig, [...] Sprecherin:",
  			"note": "optional"
  		}
  	]
  }
  ```

- `line` is 1-based; `range` is `[start, end)` char offsets **within that line**. Excerpt ellipsis uses the literal `[...]` mechanism: first segment must start exactly at `range[0]`, last segment must end exactly at `range[1]`, segments appear in order with ≥1 omitted char between them; without `[...]` the excerpt must equal the span verbatim. Enforced by `src/lib/server/coding/verify.ts`; same-line overlapping ranges are errors.
- After editing any coding file run `pnpm verify` — writes the generated `coding/progress.json` (prettier-ignored) and lists failures. `src/lib/server/coding/verify.test.ts` additionally asserts every coding file passes (part of `pnpm test:unit --run --project=server`).
- UI: `/` = dashboard (per-folder list, status chips); `/text/<folder>/<name>` = article with each coded range highlighted, clickable detail panel, per-code legend filter. Loads go through `src/lib/server/coding/store.ts` (node `fs`, executed at prerender time).
- SSG: `@sveltejs/adapter-static` + `export const prerender = true` in `src/routes/+layout.ts` — all 41 pages render at build; re-run `pnpm build` to pick up new sources (dashboard links are crawled).
- Gotcha: Vite 8's build-time `import.meta.glob` does **not** match dotfiles like `.INSTRUCTIONS.md` (dev/vitest does), so instructions files cannot be mdsvex-rendered via glob into the UI; read them from disk if needed.
- Dedicated `coding` agent (`.opencode/agent/coding.md`) runs the classification loop autonomously: writes only `coding/**`, runs the verify/test gates, no network or git-write. Select via Tab in the TUI or `opencode run --agent coding "<task>"`.

## Svelte MCP

Svelte MCP server is available (via `@sveltejs/opencode` plugin). Use `list-sections` → `get-documentation` for Svelte 5/SvelteKit questions, and MUST run `svelte-autofixer` on any written `.svelte` code until clean. Skip `playground-link` for code written into this project.
