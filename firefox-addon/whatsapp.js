(() => {
  if (window.__dashboardDraftWACompanionLoaded) return;
  window.__dashboardDraftWACompanionLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const label = (element) =>
    [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("data-icon"),
      element.getAttribute?.("aria-placeholder"),
      element.getAttribute?.("placeholder"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  async function waitFor(find, timeout = 9000, interval = 120) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = find();
      if (result) return result;
      await sleep(interval);
    }
    return null;
  }

  function elementText(element) {
    return element instanceof HTMLInputElement
      ? element.value
      : element.innerText || element.textContent || "";
  }

  function textWasInserted(element, value) {
    const actual = elementText(element).replace(/\r/g, "").trim();
    const expected = String(value).replace(/\r/g, "").trim();
    if (/^\d+$/.test(expected)) return digits(actual).includes(expected);
    return actual === expected || actual.includes(expected);
  }

  async function putText(element, value) {
    const nested = element.matches?.('[contenteditable="true"],input')
      ? element
      : element.querySelector?.('[contenteditable="true"],input');
    if (nested) element = nested;
    element.click();
    element.focus();
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: value,
        }),
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(150);
      return textWasInserted(element, value);
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false);
    document.execCommand("insertText", false, value);
    await sleep(150);
    if (textWasInserted(element, value)) return true;

    try {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", value);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: transfer,
        }),
      );
      await sleep(150);
      if (textWasInserted(element, value)) return true;
    } catch {}

    element.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertText",
        data: value,
      }),
    );
    element.textContent = value;
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: value,
      }),
    );
    await sleep(200);
    return textWasInserted(element, value);
  }

  function findNewChatButton() {
    const selectors = [
      '[data-icon*="new-chat"]',
      '[data-icon="new-chat-outline"]',
      '[data-icon="new-chat"]',
      '[data-testid="menu-bar-new-chat"]',
      '[aria-label="New chat"]',
      '[aria-label="Chat baru"]',
      '[aria-label="Obrolan baru"]',
      '[title="New chat"]',
      '[title="Chat baru"]',
      '[title="Obrolan baru"]',
    ];
    for (const selector of selectors) {
      const icon = [...document.querySelectorAll(selector)].find(visible);
      if (icon) return icon.closest("button,[role=button],[tabindex]") || icon;
    }
    const labeled = [
      ...document.querySelectorAll("button,[role=button],[tabindex]"),
    ].find(
      (element) =>
        visible(element) &&
        /new.?chat|chat.?baru|obrolan.?baru|new-chat/.test(label(element)),
    );
    if (labeled) return labeled;

    const homeSearch = [
      ...document.querySelectorAll(
        '[contenteditable="true"],[role="textbox"],input[type="text"]',
      ),
    ].find(
      (element) =>
        visible(element) &&
        /cari.*mulai.*obrolan|search.*start.*chat/.test(label(element)),
    );
    if (!homeSearch) return null;
    const searchRect = homeSearch.getBoundingClientRect();
    return (
      [...document.querySelectorAll("button,[role=button],[tabindex]")]
        .filter((element) => {
          if (!visible(element)) return false;
          const rect = element.getBoundingClientRect();
          return (
            rect.bottom <= searchRect.top + 12 &&
            rect.top >= 0 &&
            rect.left >= searchRect.left &&
            rect.right <= searchRect.right + 24 &&
            rect.width >= 28 &&
            rect.width <= 90
          );
        })
        .sort(
          (first, second) =>
            second.getBoundingClientRect().right -
            first.getBoundingClientRect().right,
        )[0] || null
    );
  }

  function findNewChatTitle() {
    return (
      [...document.querySelectorAll("h1,h2,h3,div,span")]
        .filter((element) => {
          if (!visible(element)) return false;
          const text = (element.innerText || element.textContent || "")
            .trim()
            .toLowerCase();
          return /^(obrolan baru|chat baru|new chat)$/.test(text);
        })
        .sort((first, second) => {
          const firstRect = first.getBoundingClientRect();
          const secondRect = second.getBoundingClientRect();
          return (
            firstRect.width * firstRect.height -
            secondRect.width * secondRect.height
          );
        })[0] || null
    );
  }

  function findNewChatSearchBox() {
    const title = findNewChatTitle();
    if (!title) return null;
    const titleRect = title.getBoundingClientRect();
    const candidates = [
      ...document.querySelectorAll(
        '[contenteditable="true"],[role="textbox"],input[type="text"]',
      ),
    ].filter((element) => {
      if (!visible(element) || element.closest("footer")) return false;
      const rect = element.getBoundingClientRect();
      return (
        rect.top >= titleRect.top - 8 &&
        rect.top <= titleRect.bottom + 180 &&
        rect.left < Math.min(window.innerWidth * 0.72, 900) &&
        rect.width >= 120
      );
    });
    return (
      candidates.find((element) =>
        /cari.*(nama|nomor)|search.*(name|number)|nama.*nomor|name.*number/.test(
          label(element),
        ),
      ) ||
      candidates.sort(
        (first, second) =>
          first.getBoundingClientRect().top -
          second.getBoundingClientRect().top,
      )[0] ||
      null
    );
  }

  function openNewChatWithShortcut() {
    const target = document.body || document.documentElement;
    const options = {
      key: "n",
      code: "KeyN",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    target.dispatchEvent(new KeyboardEvent("keydown", options));
    target.dispatchEvent(new KeyboardEvent("keyup", options));
  }

  function findPhoneResult(phone, searchBox) {
    const wanted = digits(phone);
    const suffix = wanted.slice(-8);
    const searchRect = searchBox.getBoundingClientRect();
    const candidates = [
      ...document.querySelectorAll(
        'div,span,[role="listitem"],[role="button"],[role="gridcell"],[tabindex="0"]',
      ),
    ].filter((element) => {
      if (!visible(element) || element.matches('[contenteditable="true"]'))
        return false;
      const rect = element.getBoundingClientRect();
      const belongsToSearchResults =
        rect.top >= searchRect.bottom - 16 &&
        rect.left < searchRect.right &&
        rect.right <= searchRect.right + 72;
      if (!belongsToSearchResults) return false;
      const found = digits(element.textContent);
      return found.includes(wanted) || (suffix && found.includes(suffix));
    });
    return (
      candidates.sort(
        (first, second) =>
          first.textContent.trim().length - second.textContent.trim().length ||
          first.getBoundingClientRect().width - second.getBoundingClientRect().width,
      )[0] || null
    );
  }

  function phoneSearchVariants(phone) {
    const original = digits(phone);
    const variants = original.startsWith("62")
      ? [`0${original.slice(2)}`, original]
      : [original];
    if (original.startsWith("0")) variants.push(`62${original.slice(1)}`);
    return [...new Set(variants.filter(Boolean))];
  }

  function findComposer() {
    const candidates = [
      ...document.querySelectorAll('[contenteditable="true"][role="textbox"]'),
    ].filter(visible);
    return (
      candidates.find(
        (element) =>
          element.closest("footer") ||
          /type.?a.?message|ketik.?pesan|message|pesan/.test(label(element)),
      ) || null
    );
  }

  async function openChat(phone, text) {
    const newChat = await waitFor(findNewChatButton, 1500);
    if (newChat) newChat.click();
    else openNewChatWithShortcut();

    // Do not accept document.activeElement here. Immediately after clicking the
    // button it can still be WhatsApp's main "search or start a new chat" box.
    // Wait until the New chat panel and its own search box are both present.
    let search = await waitFor(findNewChatSearchBox, 4000);
    if (!search && newChat) {
      openNewChatWithShortcut();
      search = await waitFor(findNewChatSearchBox, 4000);
    }
    if (!search)
      throw new Error(
        "Panel Chat baru tidak terbuka. Pastikan WhatsApp Web tidak sedang terkunci dan sudah selesai dimuat.",
      );
    let result = null;
    for (const searchPhone of phoneSearchVariants(phone)) {
      if (!(await putText(search, searchPhone)))
        throw new Error(
          "Kolom pencarian ditemukan, tetapi WhatsApp menolak pengisian nomor.",
        );
      result = await waitFor(
        () => findPhoneResult(searchPhone, search),
        4500,
      );
      if (result) break;
    }
    if (!result)
      throw new Error(
        "Nomor tidak muncul pada hasil pencarian WhatsApp, termasuk setelah mencoba format 62 dan 0. Periksa nomor atau koneksi WhatsApp Web.",
      );
    result.scrollIntoView({ block: "center" });
    result.click();

    const searchPanelClosed = await waitFor(
      () => !document.contains(search) || !visible(search),
      6000,
    );
    if (!searchPanelClosed)
      throw new Error(
        "Nomor ditemukan, tetapi baris hasil WhatsApp tidak dapat dibuka.",
      );

    const composer = await waitFor(findComposer, 8000);
    if (!composer)
      throw new Error("Kolom pesan WhatsApp tidak ditemukan.");
    if (!(await putText(composer, text)))
      throw new Error(
        "Chat sudah terbuka, tetapi WhatsApp menolak pengisian template.",
      );
    composer.focus();
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== "dashboardDraftWA:openChat") return undefined;
    return openChat(message.phone, message.text)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: error.message }));
  });
})();
