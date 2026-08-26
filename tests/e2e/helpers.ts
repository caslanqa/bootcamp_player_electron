import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { buildFixtures, type Fixtures } from '../helpers/fixtures'

export const REPO_ROOT = resolve(__dirname, '..', '..')

export interface Session {
  app: ElectronApplication
  page: Page
}

/** Every launch gets its own profile unless a caller reuses one on purpose. */
export function freshProfile(): string {
  return mkdtempSync(join(tmpdir(), 'bootcamp-e2e-'))
}

export async function launch(userDataDir: string): Promise<Session> {
  const app = await electron.launch({
    args: [join(REPO_ROOT, 'out', 'main', 'index.js')],
    cwd: REPO_ROOT,
    env: { ...process.env, BOOTCAMP_USER_DATA: userDataDir }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app')
  return { app, page }
}

export async function fixtures(): Promise<Fixtures> {
  return buildFixtures()
}

/** Types the path in directly — the native folder picker cannot be driven from a test. */
export async function addLocalSource(page: Page, root: string, name = 'Course'): Promise<void> {
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.getByTestId('local-path').fill(root)
  await page.getByLabel('Local source name').fill(name)
  await page.getByTestId('add-local-source').click()
  await expect(page.getByTestId('source-select')).toHaveValue(/.+/)
  await page.getByTestId('close-settings').click()
  await expect(page.getByTestId('settings-dialog')).toBeHidden()
}

/**
 * Idempotent: autoplay can already have opened the folder, and clicking an open
 * folder collapses it.
 */
export async function openFolder(page: Page, name: string): Promise<void> {
  const row = page.locator(`[data-testid="folder-row"][data-name="${name}"]`)
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
}

export async function playLesson(page: Page, name: string): Promise<void> {
  await page.locator(`[data-testid="media-row"][data-name="${name}"]`).click()
  await expect(page.getByTestId('now-playing')).toHaveText(name)
}

export async function videoState(page: Page): Promise<{
  currentTime: number
  duration: number
  paused: boolean
  src: string
  readyState: number
}> {
  return page.evaluate(() => {
    const video = document.querySelector('video')
    if (!video) throw new Error('no video element')
    return {
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      src: video.currentSrc,
      readyState: video.readyState
    }
  })
}

export async function seekTo(page: Page, seconds: number): Promise<void> {
  await page.evaluate((target) => {
    const video = document.querySelector('video')
    if (video) video.currentTime = target
  }, seconds)
}
