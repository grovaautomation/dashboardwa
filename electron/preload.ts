import { contextBridge, ipcRenderer } from "electron";
const call = (channel: string, ...args: any[]) =>
  ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("desktop", {
  projects: {
    list: () => call("projects:list"),
    create: (i: any) => call("projects:create", i),
    delete: (id: string) => call("projects:delete", id),
    exportBackup: (id: string) => call("projects:backup", id),
  },
  importExcel: {
    choose: () => call("excel:choose"),
    sheet: (p: string, s: string) => call("excel:sheet", p, s),
  },
  dashboard: { summary: (id: string) => call("dashboard:summary", id) },
  leads: {
    list: (id: string, f: any) => call("leads:list", id, f),
    assign: (ids: string[], c: string | null) => call("leads:assign", ids, c),
    status: (id: string, s: string, src?: string) =>
      call("leads:status", id, s, src),
    undo: (id: string) => call("leads:undo", id),
  },
  templates: {
    list: (id: string) => call("templates:list", id),
    save: (id: string, i: any) => call("templates:save", id, i),
    activate: (p: string, id: string) => call("templates:activate", p, id),
  },
  containers: {
    list: (id: string) => call("containers:list", id),
    save: (id: string, i: any[]) => call("containers:save", id, i),
    saveOne: (id: string, i: any) => call("containers:save-one", id, i),
    refresh: () => call("containers:refresh"),
  },
  setup: {
    get: () => call("setup:get"),
    saveTemplate: (name: string, body: string) =>
      call("setup:template", name, body),
    saveContainers: (items: any[]) => call("setup:containers", items),
    saveContainer: (item: any) => call("setup:container", item),
  },
  sheet: {
    settings: () => call("sheet:settings"),
    saveSettings: (input: any) => call("sheet:save-settings", input),
    test: () => call("sheet:test"),
    exportProject: (projectId: string) => call("sheet:export", projectId),
  },
  firefox: {
    settings: () => call("firefox:settings"),
    onStatus: (listener: (settings: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, settings: any) =>
        listener(settings);
      ipcRenderer.on("firefox:status", handler);
      return () => ipcRenderer.removeListener("firefox:status", handler);
    },
    openChat: (id: string) => call("firefox:open", id),
    copy: (t: string) => call("clipboard:copy", t),
  },
  audit: { list: (id: string) => call("audit:list", id) },
});
