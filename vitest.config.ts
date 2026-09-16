import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		// Unit tests only. End-to-end scenes run via the `scenetest` CLI.
		// `ci/` is in here so the PR-checks diff logic is tested by the suite the
		// project already trusts, rather than by a second, weaker test system.
		include: ['src/**/*.{test,spec}.{ts,tsx}', 'ci/**/*.{test,spec}.ts'],
		globals: true,
	},
})
