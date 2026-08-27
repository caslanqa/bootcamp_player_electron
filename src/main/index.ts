import { app, BrowserWindow, Menu, nativeTheme, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { GDriveAuth } from './auth/gdrive-oauth'
import { GDRIVE, isOnRoster } from './config'
import { registerIpc, syncDriveSource, type AppContext } from './ipc'
import { MediaPreparer } from './media/prepare'
import { ProviderRegistry } from './providers/registry'
import { StreamServer } from './server'
import { DEFAULT_LIBRARY, DEFAULT_SETTINGS, JsonStore, type LibraryData } from './store'

/** E2E runs point this at a throwaway profile so tests never touch the real one. */
if (process.env.BOOTCAMP_USER_DATA) {
  app.setPath('userData', process.env.BOOTCAMP_USER_DATA)
}

let mainWindow: BrowserWindow | null = null
let context: AppContext | null = null

/** Holds the Drive refresh token in RAM when the OS keychain is unavailable. */
const memoryToken = { refresh: null as string | null }
const MEMORY_MARKER = 'memory-only'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: '#0e1013',
    autoHideMenuBar: true,
    title: 'Bootcamp Player',
    // macOS takes the icon from the bundle and Windows from the exe; only Linux
    // needs the window/taskbar icon set at runtime.
    ...(process.platform === 'linux' ? { icon: join(__dirname, '../renderer/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Clicking a lesson is the gesture; don't make Chromium ask for a second one.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  win.once('ready-to-show', () => win.show())

  // Any link the page tries to open goes to the real browser, never a new BrowserWindow.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
  return win
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData')
  const settings = new JsonStore<Settings>(join(userData, 'settings.json'), DEFAULT_SETTINGS)
  const library = new JsonStore<LibraryData>(join(userData, 'library.json'), DEFAULT_LIBRARY)

  // A memory-only token cannot survive a restart; drop the stale marker.
  if (library.get().gdriveToken === MEMORY_MARKER && !memoryToken.refresh) {
    library.set({ gdriveToken: null, gdriveEmail: null })
  }

  nativeTheme.themeSource = settings.get().theme

  const auth = new GDriveAuth({
    openExternal: (url) => shell.openExternal(url),
    encrypt: (plain) => {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.encryptString(plain).toString('base64')
      }
      memoryToken.refresh = plain
      return MEMORY_MARKER
    },
    decrypt: (cipher) => {
      if (cipher === MEMORY_MARKER) {
        if (!memoryToken.refresh) throw new Error('Session sign-in expired')
        return memoryToken.refresh
      }
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    },
    getCredentials: () => GDRIVE,
    isOnRoster,
    loadToken: () => ({
      token: library.get().gdriveToken,
      email: library.get().gdriveEmail
    }),
    saveToken: (token, email) => library.set({ gdriveToken: token, gdriveEmail: email })
  })

  const registry = new ProviderRegistry(
    () => settings.get().sources,
    (force) => auth.getAccessToken(force)
  )

  const server = new StreamServer({
    registry,
    cachePath: (key) => preparer.cachePath(key)
  })

  const preparer = new MediaPreparer({
    cacheDir: join(userData, 'transcode-cache'),
    rawUrl: (sourceId, nodeId) => server.rawUrl(sourceId, nodeId),
    onProgress: (p) => mainWindow?.webContents.send('media:prepareProgress', p)
  })

  await server.start()

  context = {
    settings,
    library,
    registry,
    server,
    preparer,
    auth,
    window: () => mainWindow
  }
  registerIpc(context)
  // Keeps the fixed course source pointing at whatever this build was compiled
  // with, so a folder change in a new version reaches existing installs too.
  if (auth.status().signedIn) syncDriveSource(context)
  buildMenu()
  mainWindow = createWindow()
}

app.whenReady().then(boot).catch((err: Error) => {
  console.error('Startup failed:', err)
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  context?.preparer.cancelAll()
  context?.settings.flush()
  context?.library.flush()
  void context?.server.stop()
})
