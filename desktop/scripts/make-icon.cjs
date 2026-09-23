// Рисует icon.png (512×512) и icon.ico (256/48/32/16) из app-icon.svg: npx electron scripts/make-icon.cjs
// Готовый .ico избавляет electron-builder от собственного конвертера иконок.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

// ICO с PNG внутри (поддерживается начиная с Windows Vista).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

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
  const base = image.resize({ width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, "..", "icon.png"), base.toPNG());
  const ico = buildIco(
    [256, 48, 32, 16].map((size) => ({
      size,
      data: base.resize({ width: size, height: size, quality: "best" }).toPNG(),
    })),
  );
  fs.writeFileSync(path.join(__dirname, "..", "icon.ico"), ico);
  console.log("icon.png и icon.ico готовы");
  app.quit();
});
