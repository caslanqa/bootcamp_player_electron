import { expect, test } from '@playwright/test'
import {
  addLocalSource,
  fixtures,
  freshProfile,
  launch,
  openFolder,
  openSettings,
  playLesson,
  seekTo,
  videoState
} from './helpers'

/**
 * The feature the JavaFX player never had: close the app mid-lesson, come back,
 * and land where you left off. Uses one profile directory across two launches.
 */
test('resumes a lesson at the saved position after a restart', async () => {
  const paths = await fixtures()
  const profile = freshProfile()

  const first = await launch(profile)
  await addLocalSource(first.page, paths.course)
  await openFolder(first.page, '03 Long')
  await playLesson(first.page, 'long lesson.mp4')
  await expect
    .poll(async () => (await videoState(first.page)).readyState, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1)

  await seekTo(first.page, 18)
  // Progress is throttled to one write every 4s; give it a window to land.
  await expect
    .poll(async () => (await videoState(first.page)).currentTime, { timeout: 20_000 })
    .toBeGreaterThan(22)

  const before = (await videoState(first.page)).currentTime
  await first.app.close()

  const second = await launch(profile)
  // The playlist shows the partial-progress bar without any clicking.
  await openFolder(second.page, '03 Long')
  await expect(
    second.page.locator('[data-testid="media-row"][data-name="long lesson.mp4"] .mini-bar')
  ).toBeVisible()

  await playLesson(second.page, 'long lesson.mp4')
  await expect
    .poll(async () => (await videoState(second.page)).currentTime, { timeout: 20_000 })
    .toBeGreaterThan(before - 8)

  const resumed = (await videoState(second.page)).currentTime
  expect(resumed).toBeLessThan(before + 12)
  await second.app.close()
})

test('keeps settings across a restart', async () => {
  const profile = freshProfile()
  const first = await launch(profile)
  await openSettings(first.page)
  await first.page.getByTestId('theme-select').selectOption('light')
  await expect(first.page.locator('html')).toHaveAttribute('data-theme', 'light')
  await first.page.getByTestId('close-settings').click()
  await first.app.close()

  const second = await launch(profile)
  await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'light')
  await second.app.close()
})
