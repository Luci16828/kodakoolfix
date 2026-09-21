<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let counts = $derived.by(() => {
		const c = { verified: 0, failed: 0, uncoded: 0, codes: 0 };
		for (const s of data.statuses) {
			c[s.status] += 1;
			c.codes += s.codes;
		}
		return c;
	});

	let byFolder = $derived.by(() => {
		const groups = new SvelteMap<string, typeof data.statuses>();
		for (const s of data.statuses) {
			groups.set(s.folder, [...(groups.get(s.folder) ?? []), s]);
		}
		return groups;
	});
</script>

<svelte:head>
	<title>Coding dashboard</title>
</svelte:head>

<main>
	<h1>Text coding</h1>
	<p class="summary">
		<span class="chip verified">{counts.verified} verified</span>
		<span class="chip failed">{counts.failed} failed</span>
		<span class="chip uncoded">{counts.uncoded} uncoded</span>
		<span class="chip">{counts.codes} codes</span>
	</p>

	{#each byFolder as [folder, sources] (folder)}
		<section>
			<h2>{folder}/</h2>
			<ul>
				{#each sources as s (s.source)}
					<li>
						<a href={resolve('/text/[folder]/[name]', { folder: s.folder, name: s.name })}>
							<span class="name">{s.name}</span>
						</a>
						<span class="chip {s.status}">{s.status}</span>
						<span class="codes">{s.codes}</span>
						{#if s.errors.length}
							<ul class="errors">
								{#each s.errors as e (e)}
									<li>{e}</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</main>

<style>
	main {
		max-width: 44rem;
		margin: 2rem auto;
		padding: 0 1rem;
	}
	h1 {
		font-size: 1.4rem;
	}
	.summary {
		display: flex;
		gap: 0.5rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	li {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.35rem 0.5rem;
		border-radius: 4px;
	}
	li:hover {
		background: #f4f4f6;
	}
	a {
		text-decoration: none;
		color: inherit;
		flex: 1;
	}
	.name {
		font-weight: 600;
	}
	h2 {
		font-size: 1rem;
		margin: 1.5rem 0 0.25rem;
		color: #666;
	}
	.codes {
		color: #888;
		font-variant-numeric: tabular-nums;
		min-width: 2rem;
		text-align: right;
	}
	.errors {
		flex-basis: 100%;
		color: #b3261e;
		font-size: 0.85em;
		margin: 0.25rem 0;
		list-style: disc;
	}
	.chip {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 99px;
		background: #eee;
	}
	.chip.verified {
		background: #d8f0dc;
		color: #1a6b2a;
	}
	.chip.failed {
		background: #fbd8d5;
		color: #b3261e;
	}
	.chip.uncoded {
		background: #eee;
		color: #777;
	}
</style>
