<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { codeHue } from '$lib/coding/tokens';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selectedCode = $state<number | null>(null);
	let selectedToken = $state<number | null>(null);
	let activeCodes = $state(new Set<string>());

	function select(i: number) {
		selectedToken = i;
		selectedCode = data.tokens[i]?.codes[0] ?? null;
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
		return [...byCode.entries()].sort((a, b) => b[1].count - a[1].count);
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

	function stripeStyle(codes: number[]): string {
		const hues = codes.map((i) => codeHue(data.codes[i]?.code ?? ''));
		if (hues.length < 2) return `--hue: ${hues[0] ?? 0}`;
		const stripes = hues.map((h, k) => `0 ${2 + k * 3}px 0 hsl(${h} 65% 50%)`).join(', ');
		return `--hue: ${hues[0]}; --stripes: ${stripes}`;
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
						style={stripeStyle(t.codes)}
						onclick={() => select(i)}
					>
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
					style="--hue: {codeHue(code)}"
					onclick={() => toggle(code)}
				>
					{code} <span class="count">{count}</span>
				</button>
			{:else}
				<p class="muted">no codes yet</p>
			{/each}

			{#if selectedCode !== null}
				{@const entry = data.codes[selectedCode]}
				<div class="detail">
					{#if selectionCodes.length > 1}
						<div class="chips">
							{#each selectionCodes as i (i)}
								<button
									type="button"
									class="chip"
									class:active={i === selectedCode}
									style="--hue: {codeHue(data.codes[i]?.code ?? '')}"
									onclick={() => (selectedCode = i)}
								>
									{data.codes[i]?.code}
								</button>
							{/each}
						</div>
					{/if}
					<h2 style="color: hsl({codeHue(entry.code)} 60% 35%)">{entry.code}</h2>
					<p class="loc">line {entry.line}, chars {entry.range[0]}–{entry.range[1]}</p>
					<blockquote>
						{#each excerptParts(entry.excerpt) as p, i (i)}
							{p.text}{#if p.ellipsis}<mark>[...]</mark>{/if}
						{/each}
					</blockquote>
					{#if entry.note}
						<p class="note">{entry.note}</p>
					{/if}
				</div>
			{/if}
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
		color: #888;
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
		line-height: 1.7;
	}
	.coded {
		all: unset;
		display: inline;
		white-space: pre-wrap;
		cursor: pointer;
		--stripes: 0 2px 0 hsl(var(--hue) 65% 55%);
		background: hsl(var(--hue) 90% 90%);
		box-shadow: var(--stripes);
	}
	.coded:hover {
		background: hsl(var(--hue) 90% 82%);
	}
	.coded.dim {
		background: transparent;
		box-shadow: none;
		color: #999;
	}
	.coded.selected {
		background: hsl(var(--hue) 85% 72%);
	}
	.coded.multi {
		background: hsl(var(--hue) 90% 86%);
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
		color: #666;
		margin: 1rem 0 0.25rem;
	}
	.legend {
		text-align: left;
		border: 1px solid hsl(var(--hue) 60% 70%);
		background: hsl(var(--hue) 90% 92%);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
	}
	.legend.on {
		background: hsl(var(--hue) 70% 50%);
		color: white;
	}
	.count {
		color: inherit;
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}
	.detail {
		margin-top: 1rem;
		padding: 0.75rem;
		border: 1px solid #ddd;
		border-radius: 6px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-bottom: 0.5rem;
	}
	.chip {
		border: 1px solid hsl(var(--hue) 60% 70%);
		background: hsl(var(--hue) 90% 92%);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.chip.active {
		background: hsl(var(--hue) 70% 50%);
		color: white;
	}
	.loc {
		color: #888;
		font-size: 0.8rem;
	}
	blockquote {
		margin: 0.5rem 0;
		padding-left: 0.75rem;
		border-left: 3px solid #ccc;
	}
	blockquote mark {
		background: #ffe082;
		padding: 0 0.15rem;
	}
	.note,
	.muted {
		color: #666;
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
