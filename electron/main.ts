import { app, BrowserWindow, dialog, ipcMain, clipboard } from "electron";
import path from "path";
import fs from "fs";
import { LocalDatabase } from "./db";
import { readExcel } from "./excel";
import { FirefoxBridge } from "./bridge";
let win: BrowserWindow | null = null,
  db: LocalDatabase,
  bridge: FirefoxBridge;
const firefoxSettings = () => ({
  addonToken: bridge.token,
  bridgePort: bridge.port,
  addonConnected: bridge.connected(),
  addonVersion: bridge.version(),
  firefoxAvailable: firefoxAvailable(),
});
function emitFirefoxStatus() {
  if (win && !win.isDestroyed())
    win.webContents.send("firefox:status", firefoxSettings());
}
const firefoxAvailable = () =>
  [
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
  ].some(fs.existsSync);
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 560,
    minHeight: 560,
    backgroundColor: "#f4f7f5",
    title: "Dashboard Draft WA",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) win.loadURL(dev);
  else win.loadFile(path.join(__dirname, "../../dist/index.html"));
}
process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT", error);
  app.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED", error);
  app.exit(1);
});
app
  .whenReady()
  .then(() => {
    const dataDir = path.join(app.getPath("userData"), "data");
    db = new LocalDatabase(dataDir);
    bridge = new FirefoxBridge(dataDir, 47921, emitFirefoxStatus);
    registerIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    console.error("STARTUP", error);
    app.exit(1);
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
function registerIpc() {
  ipcMain.handle("projects:list", () => db.listProjects());
  ipcMain.handle("projects:create", (_, i) =>
    db.createProject(i.name, i.preview, i.mapping, i.setup),
  );
  ipcMain.handle("projects:delete", (_, id) => db.deleteProject(id));
  ipcMain.handle("projects:backup", async (_, id) => {
    const file = await dialog.showSaveDialog({
      title: "Ekspor backup proyek",
      defaultPath: `backup-draft-wa-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "Backup JSON", extensions: ["json"] }],
    });
    if (file.canceled || !file.filePath) return null;
    fs.writeFileSync(file.filePath, JSON.stringify(db.backup(id), null, 2));
    return file.filePath;
  });
  ipcMain.handle("excel:choose", async () => {
    const file = await dialog.showOpenDialog({
      title: "Pilih file Excel",
      properties: ["openFile"],
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    return file.canceled ? null : readExcel(file.filePaths[0]);
  });
  ipcMain.handle("excel:sheet", (_, p, s) => readExcel(p, s));
  ipcMain.handle("dashboard:summary", (_, id) => db.summary(id));
  ipcMain.handle("leads:list", (_, id, f) => db.listLeads(id, f));
  ipcMain.handle("leads:assign", (_, ids, c) => db.assignLeads(ids, c));
  ipcMain.handle("leads:status", (_, id, s, src) => db.setStatus(id, s, src));
  ipcMain.handle("leads:undo", (_, id) => db.undo(id));
  ipcMain.handle("templates:list", (_, id) => db.listTemplates(id));
  ipcMain.handle("templates:save", (_, id, i) => db.saveTemplate(id, i));
  ipcMain.handle("templates:activate", (_, p, id) =>
    db.activateTemplate(p, id),
  );
  ipcMain.handle("containers:list", (_, id) => db.listContainers(id));
  ipcMain.handle("containers:save", (_, id, i) => db.saveContainers(id, i));
  ipcMain.handle("containers:save-one", (_, id, i) =>
    db.saveProjectContainer(id, i),
  );
  ipcMain.handle("containers:refresh", () => bridge.refresh());
  ipcMain.handle("setup:get", () => db.getSetup());
  ipcMain.handle("setup:template", (_, name, body) =>
    db.saveSetupTemplate(name, body),
  );
  ipcMain.handle("setup:containers", (_, items) =>
    db.saveSetupContainers(items),
  );
  ipcMain.handle("setup:container", (_, item) =>
    db.saveSetupContainer(item),
  );
  ipcMain.handle("firefox:settings", firefoxSettings);
  ipcMain.handle("firefox:open", async (_, id) => {
    const lead = db.getLeadForOpen(id);
    if (!lead?.phone_normalized)
      return { ok: false, error: "Nomor WhatsApp belum valid" };
    if (!lead.cookie_store_id)
      return { ok: false, error: "Container tujuan belum dipilih" };
    if (!lead.template_body)
      return { ok: false, error: "Template aktif belum tersedia" };
    const unknown = [...lead.template_body.matchAll(/\{([^}]+)\}/g)]
      .map((m: any) => m[1])
      .filter((x: string) => !["nama_bisnis", "business_name"].includes(x));
    if (unknown.length)
      return {
        ok: false,
        error: `Placeholder tidak didukung: {${unknown[0]}}`,
      };
    const result = await bridge.openChat({
      leadId: id,
      cookieStoreId: lead.cookie_store_id,
      phone: lead.phone_normalized,
      text: lead.message,
    });
    if (result.ok) db.setStatus(id, "opened", "open_chat");
    return result;
  });
  ipcMain.handle("clipboard:copy", (_, t) => clipboard.writeText(t));
  ipcMain.handle("audit:list", (_, id) => db.listAudit(id));
}
