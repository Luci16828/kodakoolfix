<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { buildPalette } from '$lib/coding/palette';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let palette = $derived(buildPalette(data.codes.map((c) => c.code)));

	let selectedCode = $state<number | null>(null);
	let selectedToken = $state<number | null>(null);
	let hoveredToken = $state(-1);
	let activeCodes = $state(new Set<string>());
	let detailEl: HTMLDivElement | undefined = $state();

	function spanLen(i: number): number {
		const entry = data.codes[i];
		if (!entry) return Infinity;
		const lines = (entry.endLine ?? entry.line) - entry.line;
		return lines * 1_000_000 + (entry.range[1] - entry.range[0]);
	}

	function select(i: number) {
		selectedToken = i;
		const codes = data.tokens[i]?.codes ?? [];
		selectedCode = codes.length ? codes.reduce((a, b) => (spanLen(b) < spanLen(a) ? b : a)) : null;
	}

	function openDetail(i: number, e: Event) {
		select(i);
		if (!detailEl) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pad = 12;
		const width = Math.min(320, innerWidth - pad * 2);
		const height = Math.min(380, innerHeight - pad * 2);
		detailEl.style.left = `${Math.max(pad, Math.min(rect.left, innerWidth - width - pad))}px`;
		detailEl.style.top = `${Math.max(pad, Math.min(rect.bottom + 6, innerHeight - height - pad))}px`;
		if (!detailEl.matches(':popover-open')) detailEl.showPopover();
	}

	let selectionCodes = $derived(selectedToken === null ? [] : data.tokens[selectedToken].codes);

	let legend = $derived.by(() => {
		const byCode = new SvelteMap<string, { count: number; indices: number[] }>();
		data.codes.forEach((c, i) => {
			const entry = byCode.get(c.code) ?? { count: 0, indices: [] };
			entry.count += 1;
			entry.indices.push(i);
			byCode.set(c.code, entry);
		});
		return [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});

	function isActive(tokenCodes: number[]): boolean {
		if (activeCodes.size === 0) return true;
		return tokenCodes.some((i) => activeCodes.has(data.codes[i]?.code));
	}

	function toggle(code: string) {
		if (activeCodes.has(code)) activeCodes.delete(code);
		else activeCodes.add(code);
	}

	function excerptParts(excerpt: string): { text: string; ellipsis: boolean }[] {
		return excerpt.split('[...]').map((text, i, all) => ({
			text,
			ellipsis: i < all.length - 1
		}));
	}

	function codeId(code: string): string {
		return /^[0-9]+(?:\.[0-9]+)*/.exec(code)?.[0] ?? code;
	}

	function colorVars(code: string, hovered = false): string {
		const c = palette.get(code);
		if (!c) return '';
		return [
			`--fill: ${hovered ? c.light.fillHover : c.light.fill}`,
			`--fill-d: ${hovered ? c.dark.fillHover : c.dark.fill}`,
			`--marker: ${c.light.marker}`,
			`--marker-d: ${c.dark.marker}`,
			`--on-marker: ${c.light.on}`,
			`--on-marker-d: ${c.dark.on}`
		].join('; ');
	}

	function hatch(stopsColor: string[]): string {
		const w = 4;
		const p = w + 2;
		const total = stopsColor.length * p;
		const stops = stopsColor
			.flatMap((col, k) => [
				`${col} ${k * p}px ${k * p + w}px`,
				`var(--surface) ${k * p + w}px ${(k + 1) * p}px`
			])
			.concat(`${stopsColor[0]} ${total}px ${total}px`)
			.join(', ');
		return `repeating-linear-gradient(45deg, ${stops})`;
	}

	function fillStyle(ti: number): string {
		const codes = data.tokens[ti]?.codes ?? [];
		const hover = hoveredToken >= 0 ? new Set(data.tokens[hoveredToken]?.codes ?? []) : null;
		const labels = codes.map((i) => data.codes[i]?.code ?? '');
		if (codes.length === 1) return colorVars(labels[0], hover?.has(codes[0]) ?? false);
		const cs = codes.map((i, k) => ({
			c: palette.get(labels[k] ?? ''),
			h: hover?.has(i) ?? false
		}));
		if (cs.some((x) => !x.c)) return '';
		const light = hatch(cs.map((x) => (x.h ? x.c!.light.fillHover : x.c!.light.fill)));
		const dark = hatch(cs.map((x) => (x.h ? x.c!.dark.fillHover : x.c!.dark.fill)));
		return `--bg: ${light}; --bg-d: ${dark}`;
	}
</script>

<svelte:head>
	<title>{data.name} — coding</title>
</svelte:head>

<main>
	<a class="back" href={resolve('/')}>← dashboard</a>
	<h1>{data.name}</h1>
	<p class="source">{data.source}</p>
	{#if data.errors.length}
		<ul class="errors">
			{#each data.errors as e (e)}
				<li>{e}</li>
			{/each}
		</ul>
	{/if}

	<div class="columns">
		<article class="text">
			{#each data.tokens as t, i (i)}
				{#if t.codes.length === 0}
					<span>{t.text}</span>
				{:else}
					<button
						type="button"
						class="coded"
						class:dim={!isActive(t.codes)}
						class:selected={t.codes.includes(selectedCode ?? -1)}
						class:multi={t.codes.length > 1}
						title={t.codes.map((i) => data.codes[i]?.code).join(' · ')}
						style={fillStyle(i)}
						onmouseenter={() => {
							hoveredToken = i;
							select(i);
						}}
						onmouseleave={() => (hoveredToken = -1)}
						onclick={(e) => openDetail(i, e)}
					>
						{#if t.starts.length}
							<span class="cid">
								{#each t.starts as j, k (j)}
									{#if k > 0}
										<span class="sep">, </span>
									{/if}
									<span class="id" style={colorVars(data.codes[j]?.code ?? '')}
										>{codeId(data.codes[j]?.code ?? '')}</span
									>
								{/each}
							</span>
						{/if}
						{t.text}
					</button>
				{/if}
			{/each}
		</article>

		<aside>
			<h2>Codes</h2>
			{#each legend as [code, { count }] (code)}
				<button
					type="button"
					class="legend"
					class:on={activeCodes.has(code)}
					style={colorVars(code)}
					onclick={() => toggle(code)}
				>
					{code} <span class="count">{count}</span>
				</button>
			{:else}
				<p class="muted">no codes yet</p>
			{/each}

			<div class="detail" popover="auto" bind:this={detailEl}>
				{#if selectedCode !== null}
					{@const entry = data.codes[selectedCode]}
					{#if selectionCodes.length > 1}
						<div class="chips">
							{#each selectionCodes as i (i)}
								<button
									type="button"
									class="chip"
									class:active={i === selectedCode}
									style={colorVars(data.codes[i]?.code ?? '')}
									onclick={() => (selectedCode = i)}
								>
									{data.codes[i]?.code}
								</button>
							{/each}
						</div>
					{/if}
					<h2 class="codehead" style={colorVars(entry.code)}>{entry.code}</h2>
					<p class="loc">line {entry.line}, chars {entry.range[0]}–{entry.range[1]}</p>
					<blockquote>
						{#each excerptParts(entry.excerpt) as p, i (i)}
							{p.text}{#if p.ellipsis}<mark>[...]</mark>{/if}
						{/each}
					</blockquote>
					{#if entry.note}
						<p class="note">{entry.note}</p>
					{/if}
				{/if}
			</div>
		</aside>
	</div>
</main>

<style>
	main {
		max-width: 72rem;
		margin: 2rem auto;
		padding: 0 1rem;
	}
	h1 {
		font-size: 1.3rem;
		margin-bottom: 0;
	}
	.source {
		color: var(--on-surface-variant, #888);
		font-size: 0.85rem;
	}
	.errors {
		color: #b3261e;
		font-size: 0.85em;
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 18rem;
		gap: 2rem;
		align-items: start;
	}
	.text {
		white-space: pre-wrap;
		line-height: 2.4;
		font-family: var(--font-serif);
	}
	.coded {
		all: unset;
		display: inline;
		position: relative;
		line-height: normal;
		white-space: pre-wrap;
		cursor: pointer;
		background: var(--bg, var(--fill, transparent));
	}
	:root[data-theme='dark'] .coded {
		background: var(--bg-d, var(--fill-d, transparent));
	}
	.cid {
		position: absolute;
		bottom: calc(100% + 2px);
		left: 0;
		font-size: 0.62em;
		line-height: 1;
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
	}
	.cid .id {
		color: var(--marker);
	}
	:root[data-theme='dark'] .cid .id {
		color: var(--marker-d);
	}
	.cid .sep {
		color: var(--outline, #888);
	}
	.coded.dim .cid {
		display: none;
	}
	.coded.dim {
		background: transparent;
		color: inherit;
	}
	aside {
		position: sticky;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	h2 {
		font-size: 0.9rem;
		text-transform: uppercase;
		color: var(--on-surface-variant, #666);
		margin: 1rem 0 0.25rem;
	}
	.codehead {
		color: var(--marker);
	}
	:root[data-theme='dark'] .codehead {
		color: var(--marker-d);
	}
	.legend {
		text-align: left;
		border: 1px solid var(--marker);
		background: var(--fill);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
		color: var(--on-surface);
	}
	:root[data-theme='dark'] .legend {
		background: var(--fill-d);
	}
	.legend.on {
		background: var(--marker);
		color: var(--on-marker);
	}
	:root[data-theme='dark'] .legend.on {
		background: var(--marker-d);
		color: var(--on-marker-d);
	}
	.count {
		color: inherit;
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}
	.detail {
		margin: 0;
		width: min(20rem, calc(100vw - 1.5rem));
		max-height: min(24rem, calc(100vh - 1.5rem));
		overflow: auto;
		padding: 0.75rem;
		border: 1px solid var(--outline, #ddd);
		border-radius: 6px;
		background: var(--surface, white);
		color: var(--on-surface);
		box-shadow: 0 6px 20px rgb(0 0 0 / 0.15);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-bottom: 0.5rem;
	}
	.chip {
		border: 1px solid var(--marker);
		background: var(--fill);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		font-size: 0.78rem;
		cursor: pointer;
		color: var(--on-surface);
	}
	:root[data-theme='dark'] .chip {
		background: var(--fill-d);
	}
	.chip.active {
		background: var(--marker);
		color: var(--on-marker);
	}
	:root[data-theme='dark'] .chip.active {
		background: var(--marker-d);
		color: var(--on-marker-d);
	}
	.loc {
		color: var(--on-surface-variant, #888);
		font-size: 0.8rem;
	}
	blockquote {
		margin: 0.5rem 0;
		padding-left: 0.75rem;
		border-left: 3px solid var(--outline, #ccc);
		font-family: var(--font-serif);
	}
	blockquote mark {
		background: var(--primary-container, #ffe082);
		color: var(--on-primary-container, #101010);
		padding: 0 0.15rem;
	}
	.note,
	.muted {
		color: var(--on-surface-variant, #666);
		font-size: 0.85rem;
	}
	@media (max-width: 50rem) {
		.columns {
			grid-template-columns: 1fr;
		}
		aside {
			position: static;
		}
	}
</style>
