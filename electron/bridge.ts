import { randomBytes, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { FirefoxContainer } from "../shared/types";

type Pending = {
  resolve: (v: { ok: boolean; error?: string }) => void;
  timer: NodeJS.Timeout;
};
export class FirefoxBridge {
  readonly port: number;
  token: string;
  private settingsPath: string;
  private socket: WebSocket | null = null;
  private addonVersion: string | null = null;
  private containers: FirefoxContainer[] = [];
  private pending = new Map<string, Pending>();
  private wss: WebSocketServer;
  private socketAlive = false;
  private heartbeat: NodeJS.Timeout;
  private onStatusChanged?: () => void;
  constructor(dataDir: string, port = 47921, onStatusChanged?: () => void) {
    this.port = port;
    this.onStatusChanged = onStatusChanged;
    this.settingsPath = path.join(dataDir, "bridge-settings.json");
    fs.mkdirSync(dataDir, { recursive: true });
    let token = "";
    try {
      token = JSON.parse(fs.readFileSync(this.settingsPath, "utf8")).token;
    } catch {}
    if (!token) {
      token = randomBytes(24).toString("hex");
      fs.writeFileSync(this.settingsPath, JSON.stringify({ token }, null, 2));
    }
    this.token = token;
    this.wss = new WebSocketServer({ host: "127.0.0.1", port: this.port });
    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);
      const suppliedToken = url.searchParams.get("token") || "";
      if (suppliedToken !== this.token) {
        ws.close(1008, "Token tidak valid");
        return;
      }
      if (this.socket && this.socket !== ws) this.socket.close(1012, "Koneksi diganti");
      this.socket = ws;
      this.socketAlive = true;
      this.addonVersion = null;
      ws.on("pong", () => {
        if (this.socket === ws) this.socketAlive = true;
      });
      ws.on("message", (raw) => this.onMessage(raw.toString()));
      ws.on("close", () => {
        if (this.socket === ws) {
          this.socket = null;
          this.addonVersion = null;
          this.socketAlive = false;
          this.notifyStatus();
        }
      });
      this.notifyStatus();
      ws.send(JSON.stringify({ type: "listContainers" }));
    });
    this.heartbeat = setInterval(() => {
      const active = this.socket;
      if (!active || active.readyState !== WebSocket.OPEN) return;
      if (!this.socketAlive) {
        active.terminate();
        return;
      }
      this.socketAlive = false;
      active.ping();
    }, 10000);
    this.heartbeat.unref();
  }
  private notifyStatus() {
    this.onStatusChanged?.();
  }
  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "containers" && Array.isArray(msg.items)) {
      this.containers = msg.items;
      this.addonVersion =
        typeof msg.addonVersion === "string" ? msg.addonVersion : null;
      this.notifyStatus();
    }
    if (msg.type === "openChatResult" && this.pending.has(msg.requestId)) {
      const p = this.pending.get(msg.requestId)!;
      clearTimeout(p.timer);
      this.pending.delete(msg.requestId);
      p.resolve({ ok: !!msg.ok, error: msg.error });
    }
  }
  connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  version() {
    return this.addonVersion;
  }
  private versionCompatible() {
    const [major, minor] = String(this.addonVersion || "")
      .split(".")
      .map((part) => Number(part));
    return major > 1 || (major === 1 && minor >= 1);
  }
  async refresh() {
    if (!this.connected()) throw new Error("Add-on Firefox belum terhubung");
    this.socket!.send(JSON.stringify({ type: "listContainers" }));
    await new Promise((r) => setTimeout(r, 250));
    return this.containers;
  }
  openChat(payload: {
    leadId: string;
    cookieStoreId: string;
    phone: string;
    text: string;
  }) {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      if (!this.connected()) {
        resolve({ ok: false, error: "Add-on Firefox belum terhubung" });
        return;
      }
      if (!this.versionCompatible()) {
        resolve({
          ok: false,
          error:
            "Add-on Firefox masih versi lama. Pasang atau muat ulang Dashboard Draft WA Companion versi terbaru.",
        });
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: "Firefox tidak merespons" });
      }, 30000);
      this.pending.set(requestId, { resolve, timer });
      this.socket!.send(
        JSON.stringify({ type: "openChat", requestId, ...payload }),
      );
    });
  }
}
