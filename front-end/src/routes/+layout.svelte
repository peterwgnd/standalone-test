<script>
	import '../app.css';
	import { authStore } from '$lib/stores/authStore';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { children } = $props();

	// Initialize the global authentication listener
	let unsubscribeAuth;
	onMount(() => {
		unsubscribeAuth = authStore.init();
		return () => {
			if (unsubscribeAuth) unsubscribeAuth();
		};
	});

	// Route Guarding: Reactively check authentication and current route
	let path = $derived(page.url.pathname);
	let isPublic = $derived(path === '/' || path === '/login' || /^\/[^/]+\/survey\/?$/.test(path));
	let isAuthorized = $derived($authStore.user && $authStore.isAdmin);
	
	let isReadyToRender = $derived(isPublic || (!$authStore.loading && isAuthorized));

	$effect(() => {
		if (!$authStore.loading) {
			if (!isPublic && !isAuthorized) {
				goto('/login');
			} else if (isAuthorized && path === '/login') {
				goto('/dashboard');
			}
		}
	});

	// The theme configuration will eventually come from the surveyStore based on Firestore data.
	// For Phase 1, we set up the root-level injection pattern with some defaults.
	let theme = {
		primaryColor: '#000000',
		fontFamily: '"Google Sans Flex", sans-serif'
	};

	$effect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.style.setProperty('--color-primary', theme.primaryColor);
			document.documentElement.style.setProperty('--font-heading', theme.fontFamily);
		}
	});
</script>

<!-- 
	Theme variables are now safely injected via document.documentElement.style.setProperty 
	in a reactive effect above, preventing XSS vulnerabilities from malicious theme values.
-->

{#if !isReadyToRender}
	<div class="loading-state">Loading...</div>
{:else}
		<header>
			<div class="header__inner">
				<img class="header__logo" src="/assets/jigsaw-logo-grey.svg" alt="Jigsaw">
				<p class="header__title">Sensemaking with Jigsaw</p>
			</div>
		</header>

	<main>
		{@render children()}
	</main>

	<footer class="site-footer">
		<div class="footer__inner">
			<div class="footer__left">
				<img class="footer__logo" src="/assets/jigsaw-logo-grey.svg" alt="Jigsaw Logo">
			</div>
			<div class="footer__legal">
			<div>Google © 2026</div>
			<div><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Privacy &amp; Terms</a></div>
			</div>
		</div>
	</footer>
{/if}

<style>
	/* Global layout rules for the SPA wrapper */
	:global(body) {
		margin: 0;
		padding: 0;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		font-family: 'Google Sans Flex', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
		background: var(--color-bg-base);
		color: var(--color-text-base);
		font-weight: 300;
	}

	:global(main) {
		flex: 1;
	}

	.loading-state {
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 100vh;
		font-family: var(--font-heading);
	}

	/* Site Header */
	header {
		border-bottom: 1px solid var(--color-border);
		font-size: 0.85rem;
		color: var(--color-text-base);
	}

	.header__inner {
		max-width: var(--max-width);
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		padding: 1.5rem 1rem;
	}

	.header__logo {
		height: 24px;
		width: auto;
	}

	.header__title {
		margin: 0;
	}

	/* Site Footer */
	.site-footer {
		border-top: 1px solid var(--color-border);
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-top: auto;
		padding-bottom: 4rem;
	}

	.footer__inner {
		max-width: var(--max-width);
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		padding: 1.5rem 1rem;
	}

	.footer__left {
		display: flex;
		align-items: center;
	}

	.footer__logo {
		height: 24px;
		width: auto;
	}

	.footer__legal div:first-of-type {
		margin-bottom: 8px;
	}

	.footer__legal a {
		color: inherit;
		text-decoration: none;
	}

	.footer__legal a:hover {
		text-decoration: underline;
	}
</style>
