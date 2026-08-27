import { expect, test } from '@playwright/test'
import {
  addLocalSource,
  fixtures,
  freshProfile,
  launch,
  openFolder,
  type Session
} from './helpers'

let session: Session

test.beforeAll(async () => {
  const paths = await fixtures()
  session = await launch(freshProfile())
  await addLocalSource(session.page, paths.course, 'My Course')
  await openFolder(session.page, '01 Intro')
})

test.afterAll(async () => {
  await session.app.close()
})

test('search filters the loaded lessons', async () => {
  const { page } = session
  await page.getByTestId('search').fill('welcome')
  await expect(page.getByTestId('media-row')).toHaveCount(1)
  await expect(page.getByTestId('media-row')).toHaveAttribute('data-name', '01 welcome.mp4')

  await page.getByTestId('search').fill('nothing-matches-this')
  await expect(page.getByText(/No loaded lesson matches/)).toBeVisible()

  await page.getByTestId('search').fill('')
  await expect(page.getByTestId('media-row')).toHaveCount(2)
})

test('the playlist can be hidden and brought back', async () => {
  const { page } = session
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.getByLabel('Toggle playlist').click()
  await expect(page.locator('.sidebar')).toBeHidden()
  await page.getByLabel('Toggle playlist').click()
  await expect(page.locator('.sidebar')).toBeVisible()
})

test('theme switches both ways and system leaves it to the OS', async () => {
  const { page } = session
  await page.getByTestId('open-settings').click()
  await page.getByTestId('theme-select').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByTestId('theme-select').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByTestId('theme-select').selectOption('system')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  await page.getByTestId('close-settings').click()
})

test('a source can be removed again', async () => {
  const { page } = session
  const dialog = page.getByTestId('settings-dialog')
  await page.getByTestId('open-settings').click()
  await expect(dialog.locator('.source-list').getByText('My Course')).toBeVisible()
  await dialog.getByRole('button', { name: 'Remove' }).click()
  await expect(dialog.getByText('Nothing configured yet.')).toBeVisible()
  await page.getByTestId('close-settings').click()
  await expect(page.getByText('No data source configured')).toBeVisible()
})

test('keyboard shortcuts are documented in Settings', async () => {
  const { page } = session
  await page.getByTestId('open-settings').click()
  await expect(page.getByText('Play / pause')).toBeVisible()
  await expect(page.getByText('Picture in picture')).toBeVisible()
  await page.getByTestId('close-settings').click()
})

test('the updates panel reports the running version', async () => {
  const { page } = session
  await page.getByTestId('open-settings').click()

  await expect(page.getByTestId('update-panel')).toBeVisible()
  await expect(page.getByTestId('current-version')).toContainText(/Version \d+\.\d+\.\d+/)
  await expect(page.getByTestId('check-update')).toBeEnabled()

  // The real check runs against GitHub, so only assert that it resolves to one
  // of the three outcomes rather than to a spinner that never ends.
  await expect(
    page
      .getByTestId('update-none')
      .or(page.getByTestId('update-available'))
      .or(page.getByTestId('update-error'))
  ).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('close-settings').click()
})
