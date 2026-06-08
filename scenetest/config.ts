import { defineConfig } from '@scenetest/scenes'

export default defineConfig({
	// Matches `pnpm dev` (port 3000). Start the dev server before running.
	baseUrl: 'http://localhost:3000',
	browser: 'chromium',
	headed: false,
	timeout: 30000,
	actionTimeout: 8000,
})
