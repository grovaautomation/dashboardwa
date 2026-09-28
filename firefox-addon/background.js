let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
const processed = new Map();
const reconnectDelays = [250, 500, 1000, 2000];

function socketActive() {
  return socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING);
}

function scheduleReconnect(immediate = false) {
  clearTimeout(reconnectTimer);
  if (socketActive()) return;
  const delay = immediate
    ? 0
    : reconnectDelays[Math.min(reconnectAttempt++, reconnectDelays.length - 1)];
  reconnectTimer = setTimeout(connect, delay);
}

function forceReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempt = 0;
  const current = socket;
  socket = null;
  if (current && current.readyState < WebSocket.CLOSING) current.close();
  scheduleReconnect(true);
}

async function connect() {
  clearTimeout(reconnectTimer);
  if (socketActive()) return;
  const { token, port = 47921 } = await browser.storage.local.get([
    "token",
    "port",
  ]);
  if (!token) return;
  const activeSocket = new WebSocket(
    `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`,
  );
  socket = activeSocket;
  activeSocket.onopen = () => {
    if (socket !== activeSocket) return;
    reconnectAttempt = 0;
    activeSocket.send(
      JSON.stringify({
        type: "hello",
        addonVersion: browser.runtime.getManifest().version,
      }),
    );
  };
  activeSocket.onmessage = async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "listContainers") {
      const list = await browser.contextualIdentities.query({});
      activeSocket.send(
        JSON.stringify({
          type: "containers",
          addonVersion: browser.runtime.getManifest().version,
          items: list.map((item) => ({
            cookieStoreId: item.cookieStoreId,
            name: item.name,
            color: item.color,
            icon: item.icon,
          })),
        }),
      );
    }
    if (message.type === "openChat") await openChat(message);
  };
  activeSocket.onclose = () => {
    if (socket === activeSocket) {
      socket = null;
      scheduleReconnect();
    }
  };
  activeSocket.onerror = () => {
    if (activeSocket.readyState < WebSocket.CLOSING) activeSocket.close();
  };
}

async function findReusableTab(cookieStoreId) {
  const tabs = (await browser.tabs.query({}))
    .filter((tab) => tab.cookieStoreId === cookieStoreId)
    .sort((first, second) => {
      const firstWhatsApp = first.url?.startsWith("https://web.whatsapp.com/")
        ? 1
        : 0;
      const secondWhatsApp = second.url?.startsWith(
        "https://web.whatsapp.com/",
      )
        ? 1
        : 0;
      if (firstWhatsApp !== secondWhatsApp)
        return secondWhatsApp - firstWhatsApp;
      if (!!first.active !== !!second.active) return second.active ? 1 : -1;
      return (second.lastAccessed || 0) - (first.lastAccessed || 0);
    });
  return tabs[0] || null;
}

async function openChat(message) {
  if (processed.has(message.requestId)) {
    socket?.send(JSON.stringify(processed.get(message.requestId)));
    return;
  }
  let result;
  try {
    if (
      !message.leadId ||
      !message.cookieStoreId ||
      !/^[0-9]{8,15}$/.test(message.phone) ||
      typeof message.text !== "string"
    )
      throw new Error("Payload openChat tidak valid");
    await browser.contextualIdentities.get(message.cookieStoreId);
    const tab = await findReusableTab(message.cookieStoreId);
    if (!tab?.id)
      throw new Error(
        "Tidak ada tab terbuka pada container tujuan. Buka satu tab pada container tersebut, lalu coba lagi.",
      );
    if (!tab.url?.startsWith("https://web.whatsapp.com/"))
      throw new Error(
        "Tab container ditemukan, tetapi WhatsApp Web belum terbuka di tab tersebut.",
      );
    await browser.tabs.update(tab.id, { active: true });
    if (typeof tab.windowId === "number")
      await browser.windows.update(tab.windowId, { focused: true });
    await browser.tabs.executeScript(tab.id, {
      file: "/whatsapp.js",
      runAt: "document_idle",
    });
    const inPage = await browser.tabs.sendMessage(tab.id, {
      type: "dashboardDraftWA:openChat",
      phone: message.phone,
      text: message.text,
    });
    if (!inPage?.ok)
      throw new Error(
        inPage?.error ||
          "WhatsApp Web tidak dapat membuka chat tanpa memuat ulang halaman.",
      );
    result = {
      type: "openChatResult",
      requestId: message.requestId,
      ok: true,
      tabId: tab.id,
      reused: true,
      reloaded: false,
    };
  } catch (error) {
    result = {
      type: "openChatResult",
      requestId: message.requestId,
      ok: false,
      error: error.message,
    };
  }
  processed.set(message.requestId, result);
  setTimeout(() => processed.delete(message.requestId), 60000);
  socket?.send(JSON.stringify(result));
}

browser.storage.onChanged.addListener(() => {
  forceReconnect();
});
browser.runtime.onStartup.addListener(forceReconnect);
browser.runtime.onInstalled.addListener(forceReconnect);
browser.windows.onCreated.addListener(() => {
  if (!socketActive()) scheduleReconnect(true);
});
scheduleReconnect(true);
