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

// Kept out of git: this repository is public, and a committed GOCSPX- string
// trips GitHub secret scanning, which can get the credential disabled.
//   echo 'GOOGLE_CLIENT_SECRET=...' > .env     # or export it
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? ''
if (!googleClientSecret) {
  console.warn('[build] GOOGLE_CLIENT_SECRET is not set — Google Drive sign-in may fail')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    define: { __GOOGLE_CLIENT_SECRET__: JSON.stringify(googleClientSecret) },
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
