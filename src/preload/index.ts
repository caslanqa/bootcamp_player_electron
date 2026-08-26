import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/api'
import type { PrepareProgress } from '@shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

/** The only bridge between renderer and main. Nothing here exposes Node or fs. */
const api: Api = {
  settings: {
    get: () => invoke('settings:get'),
    patch: (patch) => invoke('settings:patch', patch)
  },
  sources: {
    add: (source) => invoke('sources:add', source),
    remove: (id) => invoke('sources:remove', id),
    pickFolder: () => invoke('sources:pickFolder')
  },
  tree: {
    list: (sourceId, parentId) => invoke('tree:list', sourceId, parentId)
  },
  media: {
    prepare: (sourceId, nodeId) => invoke('media:prepare', sourceId, nodeId),
    cancelPrepare: (sourceId, nodeId) => invoke('media:cancelPrepare', sourceId, nodeId),
    onPrepareProgress: (cb) => {
      const listener = (_e: unknown, p: PrepareProgress): void => cb(p)
      ipcRenderer.on('media:prepareProgress', listener)
      return () => ipcRenderer.off('media:prepareProgress', listener)
    }
  },
  progress: {
    get: (sourceId, nodeId) => invoke('progress:get', sourceId, nodeId),
    set: (sourceId, nodeId, position, duration) =>
      invoke('progress:set', sourceId, nodeId, position, duration),
    many: (sourceId, nodeIds) => invoke('progress:many', sourceId, nodeIds),
    clear: (sourceId, nodeId) => invoke('progress:clear', sourceId, nodeId)
  },
  bookmarks: {
    list: (sourceId, nodeId) => invoke('bookmarks:list', sourceId, nodeId),
    add: (sourceId, nodeId, time, note) => invoke('bookmarks:add', sourceId, nodeId, time, note),
    remove: (sourceId, nodeId, bookmarkId) =>
      invoke('bookmarks:remove', sourceId, nodeId, bookmarkId)
  },
  gdrive: {
    status: () => invoke('gdrive:status'),
    signIn: () => invoke('gdrive:signIn'),
    signOut: () => invoke('gdrive:signOut')
  },
  win: {
    setMini: (on) => invoke('win:setMini', on)
  }
}

contextBridge.exposeInMainWorld('api', api)
