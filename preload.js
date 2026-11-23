const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('clock', {
  state: () => call('state:get'),
  versions: () => call('versions:list'),
  set: (patch) => call('settings:set', patch),
  login: () => call('auth:login'),
  logout: () => call('auth:logout'),
  play: (version) => call('game:play', version),
  openFolder: () => call('folder:open'),
  minimize: () => call('win:min'),
  close: () => call('win:close'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data))
});
