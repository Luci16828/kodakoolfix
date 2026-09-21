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

Vitest splits into two projects (see `vite.config.ts`):

- `client` — component tests matching `src/**/*.svelte.{test,spec}.ts`, run headless in Chromium via `@vitest/browser-playwright` (Playwright Chromium is only installable via Nix here; without it, full `pnpm test` fails on this project — use `--project=server` to verify node tests)
- `server` — all other `*.test.ts`/`*.spec.ts` in `src/`, node environment; `src/lib/server/**` is excluded from client
- `expect.requireAssertions: true` — a test with no assertions fails

## coding_source (read-only)

- `coding_source/` holds raw data to be coded (e.g. per-newspaper `.txt` corpora). Each folder has an `.INSTRUCTIONS.md` with the exact task instructions — always read it first; if it's empty, ask the user.
- Edits to `coding_source/` are **denied** in `opencode.jsonc`. Treat the whole directory as read-only input.

## Svelte MCP

Svelte MCP server is available (via `@sveltejs/opencode` plugin). Use `list-sections` → `get-documentation` for Svelte 5/SvelteKit questions, and MUST run `svelte-autofixer` on any written `.svelte` code until clean. Skip `playground-link` for code written into this project.
