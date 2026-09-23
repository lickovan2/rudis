const { app, BrowserWindow, ipcMain, session, shell, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_URL = "https://gramanalyzer.xyz";

const configPath = () => path.join(app.getPath("userData"), "config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}

function serverUrl() {
  return (process.env.RUDIS_URL || readConfig().serverUrl || DEFAULT_URL).replace(/\/+$/, "");
}

let win = null;

function showOffline(error) {
  win.loadFile(path.join(__dirname, "offline.html"), {
    query: { url: serverUrl(), error: String(error ?? "") },
  });
}

function loadApp() {
  win.loadURL(serverUrl()).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: "#16171b",
    title: "RUdis",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  const origin = () => new URL(serverUrl()).origin;

  // Микрофон и уведомления — только для нашего сервера.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const allowed = ["media", "notifications", "clipboard-sanitized-write", "speaker-selection"];
    let fromApp = false;
    try {
      fromApp = new URL(details.requestingUrl).origin === origin();
    } catch {
      /* file:// и прочее */
    }
    callback(fromApp && allowed.includes(permission));
  });

  // Внешние ссылки открываем в системном браузере.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file:")) return;
    try {
      if (new URL(url).origin !== origin()) {
        e.preventDefault();
        void shell.openExternal(url);
      }
    } catch {
      e.preventDefault();
    }
  });

  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && !url.startsWith("file:") && code !== -3) showOffline(description);
  });

  win.webContents.on("page-title-updated", (e, title) => {
    // Счётчик непрочитанных — в значок на панели задач.
    const unread = /^\((\d+)\)/.exec(title);
    if (process.platform === "win32") win.flashFrame(!!unread && !win.isFocused());
    if (app.setBadgeCount) app.setBadgeCount(unread ? Number(unread[1]) : 0);
  });

  loadApp();
}

ipcMain.handle("rudis:set-server", (_e, url) => {
  const clean = String(url).trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(clean)) return { error: "Адрес должен начинаться с http:// или https://" };
  writeConfig({ serverUrl: clean });
  loadApp();
  return { ok: true };
});

ipcMain.handle("rudis:retry", () => loadApp());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "RUdis",
          submenu: [
            { label: "Сменить сервер…", click: () => showOffline("") },
            { label: "Перезагрузить", role: "reload" },
            { label: "Инструменты разработчика", role: "toggleDevTools" },
            { type: "separator" },
            { label: "Выход", role: "quit" },
          ],
        },
        { label: "Правка", role: "editMenu" },
      ]),
    );
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
