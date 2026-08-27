import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

// A gitignored .env is the convenient local home for the build-time secret.
// process.loadEnvFile is stdlib, so this needs no dependency.
try {
  process.loadEnvFile('.env')
} catch {
  // No .env — the env var may still come from the shell or from CI.
}

// Kept out of git. See the header of src/main/config.ts for why both halves are
// injected rather than committed.
//   printf 'GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...\n' > .env
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? ''
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? ''
const missing = [
  googleClientId ? '' : 'GOOGLE_CLIENT_ID',
  googleClientSecret ? '' : 'GOOGLE_CLIENT_SECRET'
].filter(Boolean)
if (missing.length > 0) {
  console.warn(
    `[build] ${missing.join(' and ')} not set — this build cannot sign in to Google Drive`
  )
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId),
      __GOOGLE_CLIENT_SECRET__: JSON.stringify(googleClientSecret)
    },
    build: { rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: shared },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
