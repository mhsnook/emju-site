import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		// Unit tests only. End-to-end scenes run via the `scenetest` CLI.
		// The CI delta logic is tested here rather than behind a flag of its own,
		// so it runs whenever anyone runs the suite.
		include: ['src/**/*.{test,spec}.{ts,tsx}', '.github/ci/*.test.ts'],
		globals: true,
	},
})
