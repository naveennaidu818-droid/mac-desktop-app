const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('capturePicker', {
  choose: id => ipcRenderer.invoke('select-source', id),
  onSources: callback => ipcRenderer.on('sources', (_event, sources) => callback(sources))
});
