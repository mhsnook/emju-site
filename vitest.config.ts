import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		// Unit tests only. End-to-end scenes run via the `scenetest` CLI.
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		globals: true,
	},
})
