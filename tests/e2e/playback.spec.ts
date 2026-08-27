import { expect, test } from '@playwright/test'
import {
  addLocalSource,
  fixtures,
  freshProfile,
  launch,
  openFolder,
  playLesson,
  videoState,
  type Session
} from './helpers'
import type { Fixtures } from '../helpers/fixtures'

let session: Session
let paths: Fixtures

test.beforeAll(async () => {
  paths = await fixtures()
  session = await launch(freshProfile())
  await addLocalSource(session.page, paths.course)
})

test.afterAll(async () => {
  await session.app.close()
})

test('a first launch asks you to sign in before anything else', async () => {
  const solo = await launch(freshProfile())
  // The gate itself, not the sign-in button: whether that button is offered
  // depends on the credentials this build was packaged with, which login.spec
  // covers separately.
  await expect(solo.page.locator('.login')).toBeVisible()
  await expect(solo.page.getByRole('heading', { name: 'Bootcamp Player' })).toBeVisible()
  // No player behind the gate.
  await expect(solo.page.locator('.topbar')).toHaveCount(0)

  // The local-folder escape drops the gate and opens Settings.
  await solo.page.getByTestId('login-use-local').click()
  await expect(solo.page.getByTestId('settings-dialog')).toBeVisible()
  await solo.page.getByTestId('close-settings').click()
  await expect(solo.page.getByTestId('stage-placeholder')).toBeVisible()
  await solo.app.close()
})

test('shows course folders, lazily loads their lessons', async () => {
  const { page } = session
  await expect(page.getByTestId('folder-row')).toHaveCount(3)
  await expect(page.getByTestId('media-row')).toHaveCount(0)

  await openFolder(page, '01 Intro')
  await expect(page.getByTestId('media-row')).toHaveCount(2)
  await expect(page.locator('[data-testid="media-row"]').first()).toHaveAttribute(
    'data-name',
    '01 welcome.mp4'
  )
})

test('plays a lesson through the local stream server', async () => {
  const { page } = session
  await playLesson(page, '01 welcome.mp4')

  await expect
    .poll(async () => (await videoState(page)).readyState, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1)

  const state = await videoState(page)
  expect(state.src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/raw\//)
  expect(state.duration).toBeGreaterThan(2)

  await expect.poll(async () => (await videoState(page)).currentTime).toBeGreaterThan(0.2)
  expect((await videoState(page)).paused).toBe(false)
})

test('the play button pauses and resumes', async () => {
  const { page } = session
  await page.getByTestId('play').click()
  await expect.poll(async () => (await videoState(page)).paused).toBe(true)
  await page.getByTestId('play').click()
  await expect.poll(async () => (await videoState(page)).paused).toBe(false)
})

test('loads the sidecar subtitle tracks', async () => {
  const { page } = session
  await expect(page.getByTestId('subtitles')).toBeVisible()
  const labels = await page.getByTestId('subtitles').locator('option').allTextContents()
  expect(labels).toEqual(['Subtitles off', 'Subtitles', 'tr'])

  const cues = await page.evaluate(() => {
    const video = document.querySelector('video')
    const track = video?.textTracks[0]
    return { mode: track?.mode, label: track?.label }
  })
  expect(cues.label).toBe('Subtitles')
  expect(cues.mode).toBe('showing')
})

test('the next button advances to the following lesson', async () => {
  const { page } = session
  await page.getByTestId('next').click()
  await expect(page.getByTestId('now-playing')).toHaveText('02 setup.mp4')
})

test('marks a finished lesson as watched in the playlist', async () => {
  const { page } = session
  // 02 setup.mp4 is two seconds long; let it run out.
  await expect
    .poll(
      async () =>
        page
          .locator('[data-testid="media-row"][data-name="02 setup.mp4"] .check')
          .count(),
      { timeout: 25_000 }
    )
    .toBe(1)
})

test('remuxes an mkv and plays it from the cache', async () => {
  const { page } = session
  await openFolder(page, '02 Advanced')
  await playLesson(page, 'exotic.mkv')

  await expect
    .poll(async () => (await videoState(page)).src, { timeout: 60_000 })
    .toMatch(/\/cache\//)
  await expect(page.locator('.now-playing .mode')).toHaveText('remuxed')
})

test('bookmarks a moment and jumps back to it', async () => {
  const { page } = session
  await openFolder(page, '03 Long')
  await playLesson(page, 'long lesson.mp4')
  await expect.poll(async () => (await videoState(page)).readyState).toBeGreaterThanOrEqual(1)

  await page.getByTestId('note-input').fill('important bit')
  await page.getByTestId('add-bookmark').click()

  const list = page.getByTestId('bookmark-list').locator('li')
  await expect(list).toHaveCount(1)
  await expect(list.first()).toContainText('important bit')

  await page.evaluate(() => {
    const video = document.querySelector('video')
    if (video) video.currentTime = 25
  })
  await expect.poll(async () => (await videoState(page)).currentTime).toBeGreaterThan(20)

  await list.first().locator('button').first().click()
  await expect.poll(async () => (await videoState(page)).currentTime).toBeLessThan(20)
})
