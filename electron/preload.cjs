const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jass', {
  dashboard: () => ipcRenderer.invoke('dashboard'),
  projects: { list: () => ipcRenderer.invoke('projects:list'), create: (data) => ipcRenderer.invoke('projects:create', data), update: (data) => ipcRenderer.invoke('projects:update', data), delete: (id) => ipcRenderer.invoke('projects:delete', id) },
  targets: { add: (data) => ipcRenderer.invoke('targets:add', data), list: (id) => ipcRenderer.invoke('targets:list', { projectId: id }), remove: (id) => ipcRenderer.invoke('targets:remove', id) },
  extract: { fetch: (data) => ipcRenderer.invoke('extract:fetch', data), preview: (data) => ipcRenderer.invoke('extract:preview', data), crawl: (data) => ipcRenderer.invoke('extract:crawl', data), save: (data) => ipcRenderer.invoke('extract:save', data) },
  records: { list: (id) => ipcRenderer.invoke('records:list', { projectId: id }), export: (data) => ipcRenderer.invoke('records:export', data) },
  snapshots: { list: (id) => ipcRenderer.invoke('snapshots:list', { projectId: id }), compare: (data) => ipcRenderer.invoke('snapshots:compare', data) },
  settings: { get: (id) => ipcRenderer.invoke('settings:get', { projectId: id }), save: (data) => ipcRenderer.invoke('settings:save', data) },
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});

