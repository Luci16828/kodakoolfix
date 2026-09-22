<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Tree } from 'melt/builders';
	import { buildPalette } from '$lib/coding/palette';
	import type { Slug } from '$lib/coding/shortlabel';
	import { buildTokens } from '$lib/coding/tokens';
	import { entryFromOffsets, lineStarts } from '$lib/coding/edit';
	import type { CodeEntry } from '$lib/coding/types';
	import { verifyEntry } from '$lib/coding/verify';
	import { addEntry, importSource, pushSource, watchSource } from '$lib/client/coding-db';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	let dbEntries = $state<CodeEntry[] | null>(null);
	let dirtyCount = $state(0);
	let selectedDevice = $state<string | null>(null);
	let cursor = $state({ x: 0, y: 0 });
	let dragging = $state(false);
	let editMsg = $state<string | null>(null);
	let saveMsg = $state<string | null>(null);
	let saving = $state(false);
	let articleEl = $state<HTMLElement | null>(null);

	function toEntry(c: (typeof data.codes)[number]): CodeEntry {
		const e: CodeEntry = { line: c.line, range: c.range, excerpt: c.excerpt };
		if (c.device !== undefined) e.device = c.device;
		else e.code = c.code;
		if (c.endLine !== undefined) e.endLine = c.endLine;
		if (c.note !== undefined) e.note = c.note;
		return e;
	}

	const entries = $derived(dbEntries ?? data.codes.map(toEntry));
	const armed = $derived(selectedDevice !== null);

	const displayByDevice = $derived.by(() => {
		const map = new Map<string, string>();
		const walk = (ns: typeof data.catalog): void => {
			for (const n of ns) {
				map.set(n.id, `${n.code} ${n.name}`);
				walk(n.children);
			}
		};
		walk(data.catalog);
		return map;
	});

	const codes = $derived.by(() =>
		entries.map((e) => ({
			...e,
			code:
				(e.device !== undefined ? displayByDevice.get(e.device) : undefined) ??
				e.code ??
				e.device ??
				'(unknown)'
		}))
	);

	const tokens = $derived(buildTokens(data.text, codes));

	const textState = $derived.by(() => ({ text: data.text, starts: lineStarts(data.text) }));

	let palette = $derived.by(() => {
		const keys: string[] = [];
		const walk = (ns: typeof data.catalog): void => {
			for (const n of ns) {
				keys.push(n.code);
				walk(n.children);
			}
		};
		walk(data.catalog);
		return buildPalette([...new Set([...keys, ...codes.map((c) => c.code)])]);
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
		const own = dbEntries === null ? n.item.count : (entryCountsById.get(n.item.id) ?? 0);
		return own + (n.children?.reduce((s, c) => s + countOf(c), 0) ?? 0);
	}

	let hoveredToken = $state(-1);
	let hoveredEntry = $state(-1);
	let expandedEntry = $state(-1);
	let hoverFilter = $state<string | null>(null);

	function toggleExpand(i: number) {
		expandedEntry = expandedEntry === i ? -1 : i;
	}

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

	const entryCountsById = $derived.by(() => {
		const map = new Map<string, number>();
		for (const e of entries) {
			const key = e.device ?? e.code;
			if (key === undefined) continue;
			const id = keyToId.get(key) ?? key;
			map.set(id, (map.get(id) ?? 0) + 1);
		}
		return map;
	});

	function filterKey(i: number): string | undefined {
		const entry = codes[i];
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

	const nameById = $derived.by(() => {
		const map = new Map<string, string>();
		const walk = (ns: typeof data.catalog): void => {
			for (const n of ns) {
				map.set(n.id, n.name || n.id);
				walk(n.children);
			}
		};
		walk(data.catalog);
		return map;
	});

	function entryName(i: number): string {
		const key = filterKey(i);
		if (key === undefined) return codes[i]?.code ?? '';
		return nameById.get(key) ?? codes[i]?.code ?? '';
	}

	function chipLabel(i: number): string {
		const key = filterKey(i);
		const slug = key === undefined ? null : (slugById.get(key) ?? null);
		return slug?.short ?? codeId(codes[i]?.code ?? '');
	}

	function chipHot(j: number): boolean {
		return j === hoveredEntry || (narrowestEntry !== null && j === narrowestEntry);
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

	function entrySpan(i: number): number {
		const entry = codes[i];
		if (!entry) return Infinity;
		const lines = (entry.endLine ?? entry.line) - entry.line;
		return lines * 1_000_000 + (entry.range[1] - entry.range[0]);
	}

	const narrowestEntry = $derived.by(() => {
		if (hoveredToken < 0) return null;
		const cc = tokens[hoveredToken].codes;
		if (cc.length === 0) return null;
		return cc.reduce((a, b) => (entrySpan(b) < entrySpan(a) ? b : a));
	});

	function hotSetFor(codes: number[]): Set<number> {
		const s = new Set<number>();
		if (hoveredEntry >= 0 && codes.includes(hoveredEntry)) s.add(hoveredEntry);
		if (narrowestEntry !== null && codes.includes(narrowestEntry)) s.add(narrowestEntry);
		return s;
	}

	function isFocused(codes: number[]): boolean {
		return hotSetFor(codes).size > 0;
	}

	const hoverFilterKeys = $derived.by(() => {
		if (hoverFilter === null) return null;
		const find = (ns: typeof data.catalog): (typeof data.catalog)[number] | null => {
			for (const n of ns) {
				if (n.id === hoverFilter) return n;
				const f = find(n.children);
				if (f) return f;
			}
			return null;
		};
		const node = find(data.catalog);
		if (!node) return null;
		const ids = new Set<string>();
		const collect = (n: (typeof data.catalog)[number]): void => {
			ids.add(n.id);
			for (const c of n.children) collect(c);
		};
		collect(node);
		return ids;
	});

	function isActive(tokenCodes: number[]): boolean {
		if (hoverFilterKeys === null) return true;
		return tokenCodes.some((i) => {
			const key = filterKey(i);
			return key !== undefined && hoverFilterKeys.has(key);
		});
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

	function fillStyle(ti: number, faded = false): string {
		const tcs = tokens[ti]?.codes ?? [];
		const cs = tcs.map((i) => ({ i, c: palette.get(codes[i]?.code ?? '') }));
		const mix = (col: string) => (faded ? `color-mix(in srgb, ${col} 32%, transparent)` : col);
		if (tcs.length === 0 || cs.some((x) => !x.c)) return '';
		const hotSet = hotSetFor(tcs);
		if (tcs.length === 1) {
			const c = cs[0].c!;
			return [
				colorVars(codes[tcs[0]]?.code ?? ''),
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

	onMount(() => {
		let disposed = false;
		let unsub: (() => void) | null = null;
		void (async () => {
			await importSource(data.source, data.codes.map(toEntry));
			const stop = watchSource(data.source, (es, dirty) => {
				if (disposed) return;
				dbEntries = es;
				dirtyCount = dirty;
			});
			if (disposed) stop();
			else unsub = stop;
		})();
		return () => {
			disposed = true;
			unsub?.();
		};
	});

	function tokenOffset(node: Node, offset: number): number | null {
		if (!articleEl) return null;
		let target: Node = node;
		let off = offset;
		if (target.nodeType === Node.ELEMENT_NODE) {
			const el = target as Element;
			if (el === articleEl) {
				target = articleEl.firstChild ?? articleEl;
				off = 0;
			} else if (el.classList.contains('coded')) {
				target = el.firstChild ?? el;
				off = off > 0 ? (target.textContent?.length ?? 0) : 0;
			} else {
				const nearest = el.closest('.coded');
				if (!nearest?.firstChild) return null;
				target = nearest.firstChild;
				off = nearest.textContent?.length ?? 0;
			}
		}
		if (target.nodeType !== Node.TEXT_NODE) return null;
		const holder = (target as Text).parentElement;
		if (!holder || holder.dataset.ti === undefined) return null;
		const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) => {
				const p = (n as Text).parentElement;
				return p && p.dataset.ti !== undefined
					? NodeFilter.FILTER_ACCEPT
					: NodeFilter.FILTER_REJECT;
			}
		});
		let acc = 0;
		while (walker.nextNode()) {
			if (walker.currentNode === target) return acc + off;
			acc += walker.currentNode.textContent?.length ?? 0;
		}
		return null;
	}

	async function onSelect() {
		dragging = false;
		if (!selectedDevice || !articleEl) return;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		if (sel.isCollapsed || !articleEl.contains(range.commonAncestorContainer)) return;
		const a = tokenOffset(range.startContainer, range.startOffset);
		const b = tokenOffset(range.endContainer, range.endOffset);
		sel.removeAllRanges();
		if (a === null || b === null) {
			editMsg = 'selection must stay within the article text';
			return;
		}
		const from = Math.min(a, b);
		const to = Math.max(a, b);
		if (to - from < 1) return;
		const entry = entryFromOffsets(
			data.source,
			textState.starts,
			textState.text,
			from,
			to,
			selectedDevice
		);
		const err = verifyEntry(data.text, entry);
		if (err) {
			editMsg = err;
			return;
		}
		editMsg = null;
		await addEntry(data.source, entry);
	}

	function pickDevice(id: string): void {
		selectedDevice = selectedDevice === id ? null : id;
		editMsg = null;
	}

	async function save() {
		saving = true;
		const errs = await pushSource(
			{ folder: data.folder, name: data.name, source: data.source },
			entries.map((e) => ({ ...e }))
		);
		saving = false;
		saveMsg = errs.length > 0 ? errs.join('; ') : 'saved';
	}

	const selectedSlug = $derived(
		selectedDevice === null ? null : (slugById.get(selectedDevice) ?? null)
	);
	const selectedLabel = $derived(
		selectedDevice === null
			? ''
			: (selectedSlug?.short ??
					nameById.get(selectedDevice) ??
					displayByDevice.get(selectedDevice) ??
					'')
	);
</script>

<svelte:head>
	<title>{data.name} — coding</title>
</svelte:head>

<svelte:window
	onmousemove={(e) => {
		if (selectedDevice !== null) cursor = { x: e.clientX, y: e.clientY };
	}}
	onmousedown={() => (dragging = true)}
	onmouseup={onSelect}
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			selectedDevice = null;
			dragging = false;
			window.getSelection()?.removeAllRanges();
		}
	}}
/>

<main>
	<a class="back" href={resolve('/')}>← dashboard</a>
	<h1>{data.name}</h1>
	<p class="source">{data.source}</p>
	<div class="editbar">
		{#if armed}<span class="hint">select text to code it · Esc to stop</span>{/if}
		{#if dirtyCount > 0}
			<button type="button" class="save" onclick={save} disabled={saving}>
				{saving ? 'saving…' : `save ${dirtyCount} edit${dirtyCount === 1 ? '' : 's'}`}
			</button>
		{/if}
		{#if saveMsg}<span class="msg" class:err={saveMsg !== 'saved'}>{saveMsg}</span>{/if}
		{#if editMsg}<span class="msg err">{editMsg}</span>{/if}
	</div>
	{#if data.errors.length}
		<ul class="errors">
			{#each data.errors as e (e)}
				<li>{e}</li>
			{/each}
		</ul>
	{/if}

	<div class="columns">
		<article class="text" class:arm={armed} bind:this={articleEl}>
			{#each tokens as t, i (i)}
				{#if t.codes.length === 0}
					<span data-ti={i}>{t.text}</span>
				{:else}<span
						class="wrap"
						role="presentation"
						onmouseenter={() => (hoveredToken = i)}
						onmouseleave={() => (hoveredToken = -1)}
						>{#if t.starts.length}<span class="cid"
								>{#each t.starts as j, k (j)}{#if k > 0}<span class="sep">, </span>{/if}<span
										class="tag"
										>{#if expandedEntry === j && codes[j]?.note}<span class="cmt"
												>{codes[j]?.note}</span
											>{/if}<button
											type="button"
											class="id"
											class:ext={expandedEntry === j}
											class:hot={chipHot(j)}
											style={colorVars(codes[j]?.code ?? '')}
											title={codes[j]?.code}
											onmouseenter={() => (hoveredEntry = j)}
											onmouseleave={() => (hoveredEntry = -1)}
											onclick={() => toggleExpand(j)}
										>
											{chipLabel(j)}{#if expandedEntry === j}<span class="nm">{entryName(j)}</span
												>{/if}</button
										></span
									>{/each}</span
							>{/if}<span
							class="coded"
							data-ti={i}
							class:focused={isFocused(t.codes)}
							class:multi={t.codes.length > 1}
							title={t.codes.map((i) => codes[i]?.code).join(' · ')}
							style={fillStyle(i, !isActive(t.codes))}>{t.text}</span
						></span
					>{/if}
			{/each}
		</article>

		<aside>
			<h2>Frame devices</h2>
			{#snippet nodes(children: TreeNode[])}
				{#each children as n (n.id)}
					<div
						{...n.attrs}
						class="tnode"
						class:group={n.canExpand}
						class:unused={countOf(n) === 0}
						class:sel={selectedDevice === n.item.id}
						data-kind={n.item.kind}
						style={colorVars(n.item.code)}
						onmouseenter={() => (hoverFilter = n.item.id)}
						onmouseleave={() => (hoverFilter = null)}
						onclick={() => {
							if (n.canExpand) n.toggleExpand();
							else if (UUID_RE.test(n.item.id)) pickDevice(n.item.id);
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
		</aside>
	</div>

	{#if selectedDevice !== null && !dragging}
		<div
			class="ctag"
			style={`left: ${cursor.x + 14}px; top: ${cursor.y + 14}px; ${colorVars(displayByDevice.get(selectedDevice) ?? '')}`}
		>
			{selectedLabel}
		</div>
	{/if}
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
	.editbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 1.4rem;
		font-family: var(--font-sans);
		font-size: 0.8rem;
	}
	.hint {
		color: var(--on-surface-variant, #666);
		font-style: italic;
	}
	.msg {
		color: #0a6b2d;
	}
	.msg.err {
		color: #b3261e;
	}
	.save {
		font: inherit;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--outline, #888);
		background: var(--surface, white);
		color: var(--on-surface);
		cursor: pointer;
	}
	.text.arm {
		cursor: crosshair;
	}
	.ctag {
		position: fixed;
		z-index: 10;
		pointer-events: none;
		font-family: var(--font-sans);
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1;
		padding: 3px 6px;
		border-radius: 3px;
		background: var(--marker, #666);
		color: var(--on-marker, white);
		white-space: nowrap;
	}
	:root[data-theme='dark'] .ctag {
		background: var(--marker-d, #aaa);
		color: var(--on-marker-d, black);
	}
	.tnode {
		cursor: pointer;
	}
	.tnode.sel {
		background: var(--marker);
		color: var(--on-marker);
	}
	.tnode.sel .tnum {
		color: inherit;
	}
	:root[data-theme='dark'] .tnode.sel {
		background: var(--marker-d);
		color: var(--on-marker-d);
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 18rem;
		gap: 2rem;
		align-items: start;
	}
	.text {
		white-space: pre-wrap;
		line-height: 2.55;
		font-family: var(--font-serif);
	}
	.coded {
		position: relative;
		line-height: normal;
		white-space: pre-wrap;
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
		font-family: var(--font-sans);
		font-size: 0.7em;
		line-height: 1;
		font-weight: 700;
		white-space: nowrap;
		user-select: none;
		z-index: 1;
	}
	.wrap:hover .cid,
	.cid:has(.ext) {
		z-index: 3;
	}
	.tag {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
	}
	.cmt {
		max-width: 16rem;
		white-space: normal;
		font-weight: 400;
		font-style: italic;
		color: var(--on-surface-variant, #666);
		background: var(--surface, white);
		border-radius: 3px 3px 0 0;
		padding: 1px 5px 2px;
	}
	.id {
		all: unset;
		cursor: pointer;
		user-select: none;
		background: var(--marker);
		color: var(--on-marker);
		border-radius: 3px 3px 0 0;
		padding: 2px 5px;
	}
	.id .nm {
		font-weight: 400;
		padding-left: 0.4em;
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
		background: var(--fill, transparent);
		color: var(--on-surface);
		outline: none;
	}
	.tnode.group {
		cursor: pointer;
	}
	:root[data-theme='dark'] .tnode {
		background: var(--fill-d, transparent);
	}
	.tnode:hover {
		background: var(--marker);
		color: var(--on-marker);
	}
	:root[data-theme='dark'] .tnode:hover {
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
	.tnode:hover .tnum {
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
	@media (max-width: 50rem) {
		.columns {
			grid-template-columns: 1fr;
		}
		aside {
			position: static;
		}
	}
</style>
