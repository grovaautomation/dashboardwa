const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { zipSync, strToU8 } = require("fflate");
const { WebSocket } = require("ws");
const { LocalDatabase } = require("../dist-electron/electron/db.js");
const { readExcel } = require("../dist-electron/electron/excel.js");
const { FirefoxBridge } = require("../dist-electron/electron/bridge.js");
const {
  createSignedSheetRequest,
  validateSheetEndpoint,
} = require("../dist-electron/electron/sheetExport.js");

(async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const testDir = path.resolve(projectRoot, ".smoke-data");
  if (!testDir.startsWith(projectRoot + path.sep))
    throw new Error("Direktori smoke test tidak aman");
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const fixture = path.join(testDir, "leads.xlsx");
  const esc = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const data = [
    ["Business Name", "Primary WhatsApp", "WA Exists", "Confidence"],
    ["Toko Maju", "0812-3456-7890", "yes", "high"],
    ["Kopi Senja", "6281311122233", "yes", "medium"],
    ["Duplikat", "0812 3456 7890", "yes", "low"],
    ["Nomor Kosong", "", "", ""],
    ["", "0814-5555-6666", "yes", "high"],
  ];
  const cols = ["A", "B", "C", "D"];
  const rowsXml = data
    .map(
      (row, ri) =>
        `<row r="${ri + 1}">${row.map((v, ci) => `<c r="${cols[ci]}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Valid Leads" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
    ),
  };
  fs.writeFileSync(fixture, Buffer.from(zipSync(files)));

  const preview = await readExcel(fixture);
  assert.equal(preview.selectedSheet, "Valid Leads");
  assert.deepEqual(preview.summary, {
    total: 5,
    ready: 2,
    missing: 1,
    missingBusiness: 1,
    duplicates: 1,
  });

  const db = new LocalDatabase(testDir);
  const setupContainers = [
    {
      cookieStoreId: "firefox-container-1",
      name: "Personal",
      color: "blue",
      icon: "fingerprint",
      selected: true,
      internalLabel: "Akun 1",
    },
    {
      cookieStoreId: "firefox-container-2",
      name: "Work",
      color: "green",
      icon: "briefcase",
      selected: true,
      internalLabel: "Akun 2",
    },
  ];
  db.saveSetupTemplate("Template utama", "Halo {nama_bisnis}");
  db.saveSetupContainers(setupContainers);
  assert.equal(db.getSetup().containers.length, 2);
  assert.equal(db.getSetup().templateBody, "Halo {business_name}");
  db.saveSetupContainer({ ...setupContainers[0], internalLabel: "Akun Utama" });
  assert.equal(
    db.getSetup().containers.find(
      (item) => item.cookieStoreId === "firefox-container-1",
    ).internalLabel,
    "Akun Utama",
  );
  const project = db.createProject(
    "Uji lokal",
    preview,
    preview.suggestedMapping,
    {
      templateName: "Template utama",
      templateBody: "Halo {business_name}",
      containers: setupContainers,
      allocation: [
        { containerId: "firefox-container-1", count: 1 },
        { containerId: "firefox-container-2", count: 1 },
      ],
    },
  );
  assert.equal(project.lead_count, 5);

  const roundRobinContainers = [
    ...setupContainers,
    {
      cookieStoreId: "firefox-container-3",
      name: "Sales",
      color: "red",
      icon: "briefcase",
      selected: true,
      internalLabel: "Akun 3",
    },
  ];
  const roundRobinRows = Array.from({ length: 9 }, (_, index) => ({
    "Business Name": `Lead ${index + 1}`,
    "Primary WhatsApp": `62812000000${String(index + 1).padStart(2, "0")}`,
  }));
  const roundRobinProject = db.createProject(
    "Uji round-robin",
    {
      filePath: fixture,
      fileName: "round-robin.xlsx",
      sheets: ["Valid Leads"],
      selectedSheet: "Valid Leads",
      headers: ["Business Name", "Primary WhatsApp"],
      suggestedMapping: {
        business: "Business Name",
        phone: "Primary WhatsApp",
      },
      rows: roundRobinRows,
      summary: {
        total: 9,
        ready: 9,
        missing: 0,
        missingBusiness: 0,
        duplicates: 0,
      },
    },
    {
      business: "Business Name",
      phone: "Primary WhatsApp",
    },
    {
      templateName: "Template utama",
      templateBody: "Halo {business_name}",
      containers: roundRobinContainers,
      allocation: roundRobinContainers.map((container) => ({
        containerId: container.cookieStoreId,
        count: 3,
      })),
    },
  );
  assert.deepEqual(
    db
      .listLeads(roundRobinProject.id, { sort: "number" })
      .map((lead) => lead.assigned_container_id),
    [
      "firefox-container-1",
      "firefox-container-2",
      "firefox-container-3",
      "firefox-container-1",
      "firefox-container-2",
      "firefox-container-3",
      "firefox-container-1",
      "firefox-container-2",
      "firefox-container-3",
    ],
  );
  const groupedRoundRobinExport = db.getProjectForSheetExport(
    roundRobinProject.id,
  );
  assert.deepEqual(
    groupedRoundRobinExport.rows.map((item) => item.businessName),
    [
      "Lead 1",
      "Lead 4",
      "Lead 7",
      "Lead 2",
      "Lead 5",
      "Lead 8",
      "Lead 3",
      "Lead 6",
      "Lead 9",
    ],
  );
  assert.deepEqual(
    groupedRoundRobinExport.rows.map((item) => item.accountName),
    [
      "Akun 1",
      "Akun 1",
      "Akun 1",
      "Akun 2",
      "Akun 2",
      "Akun 2",
      "Akun 3",
      "Akun 3",
      "Akun 3",
    ],
  );

  db.saveProjectContainer(project.id, {
    ...setupContainers[0],
    internalLabel: "Akun Proyek",
  });
  assert.equal(
    db.listContainers(project.id).find(
      (item) => item.cookieStoreId === "firefox-container-1",
    ).internalLabel,
    "Akun Proyek",
  );
  assert.equal(
    db.getSetup().containers.find(
      (item) => item.cookieStoreId === "firefox-container-1",
    ).internalLabel,
    "Akun Proyek",
  );
  const sheetEndpoint =
    "https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789/exec";
  const sheetSecret = "s".repeat(48);
  assert.equal(validateSheetEndpoint(sheetEndpoint), sheetEndpoint);
  assert.throws(() => validateSheetEndpoint("https://example.com/exec"));
  db.saveSheetExportConfig(sheetEndpoint, sheetSecret);
  assert.deepEqual(db.getSheetExportConfig(), {
    endpointUrl: sheetEndpoint,
    secret: sheetSecret,
  });
  const exportPayload = db.getProjectForSheetExport(project.id);
  assert.equal(exportPayload.type, "export");
  assert.equal(exportPayload.rows.length, 2);
  assert.deepEqual(
    exportPayload.rows.map((item) => item.accountName),
    ["Akun Proyek", "Akun 2"],
  );
  const signed = createSignedSheetRequest(exportPayload, sheetSecret);
  const expectedSignature = crypto
    .createHmac("sha256", sheetSecret)
    .update(`${signed.timestamp}.${signed.nonce}.${signed.data}`)
    .digest("hex");
  assert.equal(signed.signature, expectedSignature);
  assert.deepEqual(
    JSON.parse(Buffer.from(signed.data, "base64url").toString("utf8")),
    JSON.parse(JSON.stringify(exportPayload)),
  );
  const summary = db.summary(project.id);
  assert.equal(summary.unprocessed, 2);
  assert.equal(summary.needs_fix, 3);
  assert.equal(summary.unassigned, 3);

  const readyLead = db.listLeads(project.id, { status: "unprocessed" })[0];
  const openable = db.getLeadForOpen(readyLead.id);
  assert.equal(openable.phone_normalized, "6281234567890");
  assert.match(openable.message, /Toko Maju/);
  db.setStatus(readyLead.id, "opened", "open_chat");
  const firstOpenedAt = db.getLeadForOpen(readyLead.id).opened_at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  db.setStatus(readyLead.id, "opened", "open_chat");
  assert.ok(db.getLeadForOpen(readyLead.id).opened_at >= firstOpenedAt);
  db.setStatus(readyLead.id, "sent", "user");
  assert.equal(db.summary(project.id).sent, 1);
  db.undo(project.id);
  assert.equal(db.summary(project.id).opened, 1);
  assert.equal(db.backup(project.id).leads.length, 5);

  let bridgeStatusChanges = 0;
  const bridge = new FirefoxBridge(
    testDir,
    47922,
    () => bridgeStatusChanges++,
  );
  const persistedToken = bridge.token;
  const rejectedSocket = new WebSocket(
    `ws://127.0.0.1:${bridge.port}/?token=${"a".repeat(48)}`,
    { origin: "moz-extension://untrusted-extension" },
  );
  const rejectedCode = await new Promise((resolve, reject) => {
    rejectedSocket.once("close", resolve);
    rejectedSocket.once("error", reject);
  });
  assert.equal(rejectedCode, 1008);
  assert.equal(bridge.token, persistedToken);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(testDir, "bridge-settings.json"), "utf8"),
    ).token,
    persistedToken,
  );
  const socket = new WebSocket(
    `ws://127.0.0.1:${bridge.port}/?token=${persistedToken}`,
    { origin: "moz-extension://dashboard-draft-wa-test" },
  );
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "listContainers")
      socket.send(
        JSON.stringify({
          type: "containers",
          addonVersion: "1.2.0",
          items: [
            {
              cookieStoreId: "firefox-container-1",
              name: "Personal",
              color: "blue",
              icon: "fingerprint",
            },
          ],
        }),
      );
    if (message.type === "openChat")
      socket.send(
        JSON.stringify({
          type: "openChatResult",
          requestId: message.requestId,
          ok: true,
          tabId: 42,
        }),
      );
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  assert.equal(bridge.token, persistedToken);
  const containers = await bridge.refresh();
  assert.equal(containers.length, 1);
  assert.equal(bridge.version(), "1.2.0");
  assert.ok(bridgeStatusChanges >= 2);
  const opened = await bridge.openChat({
    leadId: readyLead.id,
    cookieStoreId: "firefox-container-1",
    phone: "6281234567890",
    text: "Halo Toko Maju",
  });
  assert.equal(opened.ok, true);
  socket.close();
  console.log(
    "Smoke test lulus: Excel, SQLite, template, status/audit, backup, dan bridge Firefox.",
  );
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
