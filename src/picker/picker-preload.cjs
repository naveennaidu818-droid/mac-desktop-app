const { contextBridge, ipcRenderer } = require('electron');

let cachedSources = null;
let sourcesCallback = null;

ipcRenderer.on('sources', (_event, sources) => {
  cachedSources = sources;
  if (sourcesCallback) {
    sourcesCallback(sources);
  }
});

contextBridge.exposeInMainWorld('capturePicker', {
  choose: (id) => ipcRenderer.invoke('select-source', id),
  onSources: (callback) => {
    sourcesCallback = callback;
    if (cachedSources) {
      callback(cachedSources);
    }
  }
});
