const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");

function normalizePhone(value) {
  let phone = String(value ?? "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  else if (phone.startsWith("8")) phone = `62${phone}`;
  return /^\d{8,15}$/.test(phone) ? phone : null;
}

async function main() {
  const [recoveredPath, cleanPath, excelPath] = process.argv.slice(2);
  if (!recoveredPath || !cleanPath || !excelPath) {
    throw new Error("Usage: node recover-corrupt-db.cjs <recovered.db> <clean.db> <source.xlsx>");
  }

  const { default: readXlsxFile } = await import("read-excel-file/node");
  const workbook = await readXlsxFile(excelPath);
  const sheet = workbook.find((item) => item.sheet === "Valid Leads") || workbook[0];
  if (!sheet) throw new Error("Workbook tidak memiliki sheet.");
  const headerRow = sheet.data[0] || [];
  const headers = headerRow.map((cell, index) => String(cell ?? "").trim() || `Kolom ${index + 1}`);
  const find = (candidates) =>
    headers.find((header) => candidates.includes(header.toLowerCase())) || "";
  const businessColumn = find(["business name", "businessname", "nama bisnis", "nama_bisnis", "name"]);
  const phoneColumn = find(["primary whatsapp", "whatsapp", "phone", "nomor whatsapp"]);
  const waExistsColumn = find(["wa exists"]);
  const confidenceColumn = find(["confidence"]);
  if (!businessColumn || !phoneColumn) throw new Error("Kolom nama bisnis/nomor WhatsApp tidak ditemukan.");
  const sourceRows = sheet.data.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])),
  ).filter((row) => Object.values(row).some(Boolean));

  const source = new DatabaseSync(recoveredPath, { readOnly: true });
  const target = new DatabaseSync(cleanPath);
  target.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_file_name TEXT NOT NULL, source_sheet_name TEXT NOT NULL, active_template_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE leads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_row_number INTEGER NOT NULL, business_name TEXT NOT NULL DEFAULT '', phone_raw TEXT NOT NULL DEFAULT '', phone_normalized TEXT, wa_exists TEXT NOT NULL DEFAULT '', confidence TEXT NOT NULL DEFAULT '', assigned_container_id TEXT, status TEXT NOT NULL, opened_at TEXT, marked_sent_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE containers (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, cookie_store_id TEXT NOT NULL, display_name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'blue', icon TEXT NOT NULL DEFAULT 'fingerprint', is_selected INTEGER NOT NULL DEFAULT 0, internal_label TEXT NOT NULL DEFAULT '', saved_at TEXT NOT NULL, PRIMARY KEY(project_id, cookie_store_id));
    CREATE TABLE templates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE status_audit (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE, old_status TEXT NOT NULL, new_status TEXT NOT NULL, changed_at TEXT NOT NULL, source TEXT NOT NULL);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE global_containers (cookie_store_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'blue', icon TEXT NOT NULL DEFAULT 'fingerprint', is_selected INTEGER NOT NULL DEFAULT 0, internal_label TEXT NOT NULL DEFAULT '', saved_at TEXT NOT NULL);
    CREATE INDEX idx_leads_project_status ON leads(project_id, status);
    CREATE INDEX idx_leads_project_container ON leads(project_id, assigned_container_id);
    CREATE INDEX idx_audit_lead_changed ON status_audit(lead_id, changed_at DESC);
  `);

  const copyRows = (table, columns, rows) => {
    const placeholders = columns.map(() => "?").join(",");
    const insert = target.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`);
    for (const row of rows) insert.run(...columns.map((column) => row[column]));
  };

  target.exec("BEGIN IMMEDIATE");
  try {
    const projects = source.prepare("SELECT * FROM projects ORDER BY created_at").all();
    const globalContainers = source.prepare("SELECT * FROM global_containers").all();
    copyRows("projects", ["id", "name", "source_file_name", "source_sheet_name", "active_template_id", "created_at", "updated_at"], projects);
    copyRows("global_containers", ["cookie_store_id", "display_name", "color", "icon", "is_selected", "internal_label", "saved_at"], globalContainers);
    copyRows("app_settings", ["key", "value"], source.prepare("SELECT * FROM app_settings").all());
    copyRows("templates", ["id", "project_id", "name", "body", "created_at", "updated_at"], source.prepare("SELECT t.* FROM templates t JOIN projects p ON p.id=t.project_id").all());

    const leadColumns = ["id", "project_id", "source_row_number", "business_name", "phone_raw", "phone_normalized", "wa_exists", "confidence", "assigned_container_id", "status", "opened_at", "marked_sent_at", "updated_at"];
    const recoveredLeads = source.prepare("SELECT l.* FROM leads l JOIN projects p ON p.id=l.project_id WHERE l.id IS NOT NULL AND l.source_row_number IS NOT NULL AND l.business_name IS NOT NULL AND l.phone_raw IS NOT NULL AND l.status IS NOT NULL AND l.updated_at IS NOT NULL").all();
    copyRows("leads", leadColumns, recoveredLeads);

    const referenceAssignments = new Map(
      source.prepare("SELECT source_row_number,assigned_container_id FROM leads WHERE project_id=(SELECT project_id FROM leads GROUP BY project_id HAVING COUNT(*)=50 ORDER BY MIN(rowid) LIMIT 1)").all()
        .map((row) => [Number(row.source_row_number), row.assigned_container_id]),
    );
    const insertLead = target.prepare(`INSERT INTO leads (${leadColumns.join(",")}) VALUES (${leadColumns.map(() => "?").join(",")})`);
    let restored = 0;
    for (const project of projects) {
      const present = new Set(target.prepare("SELECT source_row_number FROM leads WHERE project_id=?").all(project.id).map((row) => Number(row.source_row_number)));
      const seen = new Set(target.prepare("SELECT phone_normalized FROM leads WHERE project_id=? AND phone_normalized IS NOT NULL").all(project.id).map((row) => String(row.phone_normalized)));
      for (let index = 0; index < sourceRows.length; index++) {
        const sourceRowNumber = index + 2;
        if (present.has(sourceRowNumber)) continue;
        const row = sourceRows[index];
        const businessName = String(row[businessColumn] ?? "").trim();
        const phoneRaw = String(row[phoneColumn] ?? "").trim();
        const phoneNormalized = normalizePhone(phoneRaw);
        const duplicate = !!phoneNormalized && seen.has(phoneNormalized);
        if (phoneNormalized) seen.add(phoneNormalized);
        insertLead.run(
          randomUUID(), project.id, sourceRowNumber, businessName, phoneRaw,
          phoneNormalized, String(row[waExistsColumn] ?? ""), String(row[confidenceColumn] ?? ""),
          referenceAssignments.get(sourceRowNumber) || globalContainers[0]?.cookie_store_id || null,
          !businessName || !phoneNormalized || duplicate ? "needs_fix" : "unprocessed",
          null, null, project.created_at,
        );
        restored++;
      }
    }

    const insertContainer = target.prepare("INSERT INTO containers VALUES (?,?,?,?,?,?,?,?)");
    for (const project of projects) {
      for (const container of globalContainers) {
        insertContainer.run(project.id, container.cookie_store_id, container.display_name, container.color, container.icon, container.is_selected, container.internal_label, container.saved_at);
      }
    }
    const audits = source.prepare("SELECT a.* FROM status_audit a JOIN leads l ON l.id=a.lead_id").all();
    copyRows("status_audit", ["id", "lead_id", "old_status", "new_status", "changed_at", "source"], audits);
    target.exec("COMMIT");
    target.exec("PRAGMA optimize");
    const integrity = target.prepare("PRAGMA integrity_check").get().integrity_check;
    const foreignKeys = target.prepare("PRAGMA foreign_key_check").all();
    const leadCount = Number(target.prepare("SELECT COUNT(*) count FROM leads").get().count);
    console.log(JSON.stringify({ integrity, foreignKeyErrors: foreignKeys.length, leadCount, restored }, null, 2));
  } catch (error) {
    target.exec("ROLLBACK");
    throw error;
  } finally {
    source.close();
    target.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
