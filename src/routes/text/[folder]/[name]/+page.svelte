<script lang="ts">
	import { resolve } from '$app/paths';
	import { Tree } from 'melt/builders';
	import { buildPalette } from '$lib/coding/palette';
	import type { Slug } from '$lib/coding/shortlabel';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let palette = $derived.by(() => {
		const keys: string[] = [];
		const walk = (ns: typeof data.catalog): void => {
			for (const n of ns) {
				keys.push(n.code);
				walk(n.children);
			}
		};
		walk(data.catalog);
		return buildPalette([...new Set([...keys, ...data.codes.map((c) => c.code)])]);
	});

	function expandableIds(ns: typeof data.catalog, acc: string[] = []): string[] {
		for (const n of ns) {
			if (n.children.length) {
				acc.push(n.id);
				expandableIds(n.children, acc);
			}
		}
		return acc;
	}

	const tree = $derived(
		new Tree({
			items: data.catalog,
			multiple: true,
			expanded: new Set(expandableIds(data.catalog))
		})
	);
	type TreeNode = (typeof tree.children)[number];

	function countOf(n: TreeNode): number {
		return n.item.count + (n.children?.reduce((s, c) => s + countOf(c), 0) ?? 0);
	}

	function allSelected(n: TreeNode): boolean {
		const leaves = Tree.getAllChildren(n).filter((c) => !c.canExpand);
		return leaves.length > 0 && leaves.every((l) => l.selected);
	}

	function toggleNode(n: TreeNode) {
		if (!n.canExpand) {
			n.toggleSelect();
			return;
		}
		n.toggleExpand();
		const allOn = allSelected(n);
		for (const l of Tree.getAllChildren(n).filter((c) => !c.canExpand)) {
			if (allOn) l.deselect();
			else l.select();
		}
	}

	let selectedCode = $state<number | null>(null);
	let selectedToken = $state<number | null>(null);
	let hoveredToken = $state(-1);
	let hoveredEntry = $state(-1);
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

	function placePopup(e: Event) {
		if (!detailEl) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const pad = 12;
		const width = Math.min(320, innerWidth - pad * 2);
		const height = Math.min(380, innerHeight - pad * 2);
		detailEl.style.left = `${Math.max(pad, Math.min(rect.left, innerWidth - width - pad))}px`;
		detailEl.style.top = `${Math.max(pad, rect.top - height - 6)}px`;
		if (!detailEl.matches(':popover-open')) detailEl.showPopover();
	}

	function openDetail(i: number, e: Event) {
		select(i);
		placePopup(e);
	}

	function openEntry(i: number, e: Event) {
		selectedToken = null;
		selectedCode = i;
		placePopup(e);
	}

	let selectionCodes = $derived(selectedToken === null ? [] : data.tokens[selectedToken].codes);

	const keyToId = $derived.by(() => {
		const map = new Map<string, string>();
		const walk = (ns: typeof data.catalog): void => {
			for (const n of ns) {
				map.set(n.id, n.id);
				map.set(n.code, n.id);
				for (const a of n.alias ?? []) map.set(a, n.id);
				walk(n.children);
			}
		};
		walk(data.catalog);
		return map;
	});

	function filterKey(i: number): string | undefined {
		const entry = data.codes[i];
		if (!entry) return undefined;
		const key = entry.device ?? entry.code;
		return keyToId.get(key) ?? key;
	}

	const slugById = $derived.by(() => {
		const map = new Map<string, Slug | null>();
		const walk = (ns: typeof data.catalog): void => {
			for (const n of ns) {
				map.set(n.id, n.slug);
				walk(n.children);
			}
		};
		walk(data.catalog);
		return map;
	});

	function chipLabel(i: number): string {
		const key = filterKey(i);
		const slug = key === undefined ? null : (slugById.get(key) ?? null);
		return slug?.short ?? codeId(data.codes[i]?.code ?? '');
	}

	function chipHot(j: number): boolean {
		const t = hoveredToken >= 0 ? data.tokens[hoveredToken] : undefined;
		return t?.codes.includes(j) ?? false;
	}

	function boldSegments(name: string, slug: Slug | null): { t: string; b: boolean }[] {
		if (!slug || slug.bold.length === 0) return name ? [{ t: name, b: false }] : [];
		const out: { t: string; b: boolean }[] = [];
		let i = 0;
		for (const p of [...slug.bold].sort((a, b) => a.start - b.start)) {
			if (p.start > i) out.push({ t: name.slice(i, p.start), b: false });
			out.push({ t: name.slice(p.start, p.start + p.len), b: true });
			i = p.start + p.len;
		}
		if (i < name.length) out.push({ t: name.slice(i), b: false });
		return out;
	}

	function isFocused(codes: number[]): boolean {
		if (focusEntry !== null && codes.includes(focusEntry)) return true;
		return hoveredEntry >= 0 && codes.includes(hoveredEntry);
	}

	function isActive(tokenCodes: number[]): boolean {
		if (tree.selected.size === 0) return true;
		return tokenCodes.some((i) => {
			const key = filterKey(i);
			return key !== undefined && tree.selected.has(key);
		});
	}

	function isSelectedKey(i: number): boolean {
		const key = filterKey(i);
		return key !== undefined && tree.selected.has(key);
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

	function colorVars(code: string): string {
		const c = palette.get(code);
		if (!c) return '';
		return [
			`--fill: ${c.light.fill}`,
			`--fill-d: ${c.dark.fill}`,
			`--marker: ${c.light.marker}`,
			`--marker-d: ${c.dark.marker}`,
			`--on-marker: ${c.light.on}`,
			`--on-marker-d: ${c.dark.on}`
		].join('; ');
	}

	let popoverOpen = $state(false);
	let focusEntry = $derived(
		selectedCode !== null && (hoveredToken >= 0 || popoverOpen) ? selectedCode : null
	);

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

	function fillStyle(ti: number, faded = false, hot = -1): string {
		const codes = data.tokens[ti]?.codes ?? [];
		const cs = codes.map((i) => ({ i, c: palette.get(data.codes[i]?.code ?? '') }));
		const mix = (col: string) => (faded ? `color-mix(in srgb, ${col} 32%, transparent)` : col);
		if (codes.length === 0 || cs.some((x) => !x.c)) return '';
		const hotSet = new Set<number>();
		if (focusEntry !== null) hotSet.add(focusEntry);
		if (hot >= 0) hotSet.add(hot);
		if (codes.length === 1) {
			const c = cs[0].c!;
			return [
				colorVars(data.codes[codes[0]]?.code ?? ''),
				faded ? `--fill: ${mix(c.light.fill)}; --fill-d: ${mix(c.dark.fill)}` : '',
				`--bg-hl: linear-gradient(${c.light.fillHover}, ${c.light.fillHover})`,
				`--bg-hl-d: linear-gradient(${c.dark.fillHover}, ${c.dark.fillHover})`
			]
				.filter(Boolean)
				.join('; ');
		}
		const hl = hotSet.size > 0;
		const light = hatch(
			cs.map((x) => (hl && hotSet.has(x.i) ? x.c!.light.fillHover : mix(x.c!.light.fill)))
		);
		const darkG = hatch(
			cs.map((x) => (hl && hotSet.has(x.i) ? x.c!.dark.fillHover : mix(x.c!.dark.fill)))
		);
		return `--bg: ${light}; --bg-d: ${darkG}; --bg-hl: ${hl ? light : 'none'}; --bg-hl-d: ${hl ? darkG : 'none'}`;
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
				{:else}<span class="wrap"
						>{#if t.starts.length}<span class="cid"
								>{#each t.starts as j, k (j)}{#if k > 0}<span class="sep">, </span>{/if}<button
										type="button"
										class="id"
										class:active={isSelectedKey(j)}
										class:hot={chipHot(j)}
										style={colorVars(data.codes[j]?.code ?? '')}
										title={data.codes[j]?.code}
										onmouseenter={() => (hoveredEntry = j)}
										onmouseleave={() => (hoveredEntry = -1)}
										onclick={(e) => openEntry(j, e)}
									>
										{chipLabel(j)}
									</button>{/each}</span
							>{/if}<button
							type="button"
							class="coded"
							class:focused={isFocused(t.codes)}
							class:multi={t.codes.length > 1}
							title={t.codes.map((i) => data.codes[i]?.code).join(' · ')}
							style={fillStyle(i, !isActive(t.codes), hoveredEntry)}
							onmouseenter={() => {
								hoveredToken = i;
								select(i);
							}}
							onmouseleave={() => (hoveredToken = -1)}
							onclick={(e) => openDetail(i, e)}
						>
							{t.text}
						</button></span
					>{/if}
			{/each}
		</article>

		<aside>
			<h2 class="head">
				Frame devices
				<button
					type="button"
					class="clear"
					class:visible={tree.selected.size > 0}
					onclick={() => tree.clearSelection()}
				>
					clear filter
				</button>
			</h2>
			{#snippet nodes(children: TreeNode[])}
				{#each children as n (n.id)}
					<div
						{...n.attrs}
						class="tnode"
						class:group={n.canExpand}
						class:unused={countOf(n) === 0}
						class:partial={n.selected || (n.canExpand && countOf(n) > 0 && !allSelected(n))}
						data-kind={n.item.kind}
						style={colorVars(n.item.code)}
						onclick={(e) => {
							e.stopPropagation();
							toggleNode(n);
						}}
					>
						<span class="caret" class:hidden={!n.canExpand} aria-hidden="true"
							>{n.canExpand ? (n.expanded ? '▾' : '▸') : ''}</span
						>
						<span class="tnum" title={n.item.code}>{n.item.slug?.short ?? codeId(n.item.code)}</span
						>
						<span class="tname"
							>{#each boldSegments(n.item.name, n.item.slug) as seg, si (si)}{#if seg.b}<b
										>{seg.t}</b
									>{:else}{seg.t}{/if}{/each}</span
						>
						<span class="tcount">{countOf(n) || ''}</span>
					</div>
					{#if n.canExpand && n.expanded}
						<div {...tree.group}>{@render nodes(n.children ?? [])}</div>
					{/if}
				{/each}
			{/snippet}
			<div {...tree.root} class="tree">
				{@render nodes(tree.children)}
			</div>

			<div
				class="detail"
				popover="auto"
				bind:this={detailEl}
				ontoggle={(e) => (popoverOpen = (e as ToggleEvent).newState === 'open')}
			>
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
	.wrap {
		position: relative;
	}
	.cid {
		position: absolute;
		bottom: 100%;
		left: 0;
		font-size: 0.62em;
		line-height: 1;
		font-weight: 600;
		white-space: nowrap;
		user-select: none;
		z-index: 1;
	}
	.cid .id {
		all: unset;
		cursor: pointer;
		user-select: none;
		background: var(--marker);
		color: var(--on-marker);
		border-radius: 3px 3px 0 0;
		padding: 1.5px 4px;
	}
	:root[data-theme='dark'] .cid .id {
		background: var(--marker-d);
		color: var(--on-marker-d);
	}
	.cid .id:hover,
	.cid .id.hot {
		filter: brightness(1.2);
	}
	:root[data-theme='dark'] .cid .id:hover,
	:root[data-theme='dark'] .cid .id.hot {
		filter: brightness(1.35);
	}
	.cid .id:focus-visible {
		outline: 2px solid var(--marker);
		outline-offset: 1px;
	}
	.cid .id.active {
		box-shadow: 0 0 0 1.5px var(--marker);
	}
	.cid .sep {
		color: var(--outline, #888);
	}
	.coded {
		position: relative;
		isolation: isolate;
	}
	.coded::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background-image: var(--bg-hl, none);
		opacity: 0;
		transition: opacity 0.15s;
		pointer-events: none;
	}
	:root[data-theme='dark'] .coded::after {
		background-image: var(--bg-hl-d, none);
	}
	.coded.focused::after {
		opacity: 1;
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
	h2.head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.codehead {
		color: var(--marker);
	}
	:root[data-theme='dark'] .codehead {
		color: var(--marker-d);
	}
	.tree {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		outline: none;
	}
	.tnode {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		text-align: left;
		border: 1px solid var(--marker, transparent);
		background: var(--fill, transparent);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
		color: var(--on-surface);
	}
	:root[data-theme='dark'] .tnode {
		background: var(--fill-d, transparent);
	}
	.tnode[data-selected] {
		background: var(--marker);
		color: var(--on-marker);
	}
	:root[data-theme='dark'] .tnode[data-selected] {
		background: var(--marker-d);
		color: var(--on-marker-d);
	}
	.tnode.unused {
		opacity: 0.55;
	}
	.caret {
		width: 0.9rem;
		flex: none;
		text-align: center;
		color: var(--on-surface-variant, #888);
	}
	.caret.hidden {
		visibility: hidden;
	}
	.tnum {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--marker);
	}
	:root[data-theme='dark'] .tnum {
		color: var(--marker-d);
	}
	.tnode[data-selected] .tnum {
		color: inherit;
	}
	.tname {
		flex: 1;
		font-size: 0.85rem;
	}
	.tcount {
		color: inherit;
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}
	div[role='group'] {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding-left: 1rem;
		border-left: 1px solid var(--outline, #ccc);
		margin-left: 0.4rem;
	}
	.clear {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--primary, #4055a8);
		cursor: pointer;
		font-size: 0.8rem;
		text-transform: none;
		letter-spacing: normal;
		padding: 0.2rem 0;
		visibility: hidden;
	}
	.clear.visible {
		visibility: visible;
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
