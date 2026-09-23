const { contextBridge, ipcRenderer } = require("electron");

// Доступно только странице «Нет соединения» (file://) — выбор адреса сервера.
if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("rudisDesktop", {
    setServer: (url) => ipcRenderer.invoke("rudis:set-server", url),
    retry: () => ipcRenderer.invoke("rudis:retry"),
  });
}
