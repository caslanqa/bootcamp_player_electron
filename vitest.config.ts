import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    projects: [
      {
        resolve: { alias: { '@shared': resolve('src/shared') } },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        resolve: { alias: { '@shared': resolve('src/shared') } },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // ffmpeg spawns real processes; keep them from fighting over CPU
          fileParallelism: false
        }
      }
    ]
  }
})
