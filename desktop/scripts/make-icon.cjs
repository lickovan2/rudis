// Рисует icon.png (512×512) из app-icon.svg: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "..", "app-icon.svg"), "utf8");
  const html = `<html><body style="margin:0;background:transparent">
    <div style="width:512px;height:512px">${svg.replace("<svg ", '<svg width="512" height="512" ')}</div>
  </body></html>`;
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, "..", "icon.png"), image.resize({ width: 512, height: 512 }).toPNG());
  console.log("icon.png готов");
  app.quit();
});
