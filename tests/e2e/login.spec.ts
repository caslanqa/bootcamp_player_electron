import { expect, test } from '@playwright/test'
import { addLocalSource, fixtures, freshProfile, launch, openSettings } from './helpers'

test('the gate explains itself and offers a way past', async () => {
  const { app, page } = await launch(freshProfile())

  await expect(page.getByRole('heading', { name: 'Bootcamp Player' })).toBeVisible()
  await expect(page.getByText(/course folder was shared with/)).toBeVisible()
  // This build has a client id compiled in, so the Google button is live.
  await expect(page.getByTestId('login-google')).toBeEnabled()
  await expect(page.getByTestId('login-unconfigured')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Trouble signing in/ })).toBeVisible()

  await app.close()
})

test('remember me defaults to on and can be turned off', async () => {
  const { app, page } = await launch(freshProfile())
  const remember = page.getByTestId('login-remember')

  await expect(remember).toBeChecked()
  await remember.uncheck()
  await expect(remember).not.toBeChecked()

  await app.close()
})

test('a configured source skips the gate on the next launch', async () => {
  const paths = await fixtures()
  const profile = freshProfile()

  const first = await launch(profile)
  await expect(first.page.getByTestId('login-google')).toBeVisible()
  await addLocalSource(first.page, paths.course)
  await first.app.close()

  const second = await launch(profile)
  // Straight to the player: the gate is for accounts, not for local folders.
  await expect(second.page.locator('.topbar')).toBeVisible()
  await expect(second.page.getByTestId('login-google')).toHaveCount(0)
  await expect(second.page.getByTestId('source-select')).toHaveValue(/.+/)
  await second.app.close()
})

test('the admin panel stays hidden for a signed-out user', async () => {
  const paths = await fixtures()
  const { app, page } = await launch(freshProfile())
  await addLocalSource(page, paths.course)

  await openSettings(page)
  await expect(page.getByTestId('admin-panel')).toHaveCount(0)
  await expect(page.getByText('Not connected')).toBeVisible()
  await page.getByTestId('close-settings').click()

  await app.close()
})
