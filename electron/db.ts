import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type {
  FirefoxContainer,
  ImportPreview,
  LeadStatus,
  ProjectSetup,
  SetupPreferences,
} from "../shared/types";

export class LocalDatabase {
  private db: DatabaseSync;
  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "dashboard-draft-wa.db"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }
  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_file_name TEXT NOT NULL, source_sheet_name TEXT NOT NULL, active_template_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_row_number INTEGER NOT NULL, business_name TEXT NOT NULL DEFAULT '', phone_raw TEXT NOT NULL DEFAULT '', phone_normalized TEXT, wa_exists TEXT NOT NULL DEFAULT '', confidence TEXT NOT NULL DEFAULT '', assigned_container_id TEXT, status TEXT NOT NULL, opened_at TEXT, marked_sent_at TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS containers (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, cookie_store_id TEXT NOT NULL, display_name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'blue', icon TEXT NOT NULL DEFAULT 'fingerprint', is_selected INTEGER NOT NULL DEFAULT 0, internal_label TEXT NOT NULL DEFAULT '', saved_at TEXT NOT NULL, PRIMARY KEY(project_id, cookie_store_id));
      CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS status_audit (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE, old_status TEXT NOT NULL, new_status TEXT NOT NULL, changed_at TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS global_containers (cookie_store_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'blue', icon TEXT NOT NULL DEFAULT 'fingerprint', is_selected INTEGER NOT NULL DEFAULT 0, internal_label TEXT NOT NULL DEFAULT '', saved_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_leads_project_status ON leads(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_leads_project_container ON leads(project_id, assigned_container_id);
      CREATE INDEX IF NOT EXISTS idx_audit_lead_changed ON status_audit(lead_id, changed_at DESC);
    `);
    const selectionDefault = this.db
      .prepare("SELECT value FROM app_settings WHERE key='container_selection_default'")
      .get() as { value?: string } | undefined;
    if (!selectionDefault) {
      this.db.exec(`
        UPDATE global_containers SET is_selected=1;
        INSERT INTO app_settings(key,value) VALUES ('container_selection_default','all_v1');
      `);
    }
    this.db.exec("PRAGMA optimize;");
  }
  private transaction(fn: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  listProjects() {
    return this.db
      .prepare(
        `SELECT p.*, COUNT(l.id) lead_count FROM projects p LEFT JOIN leads l ON l.project_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC`,
      )
      .all();
  }
  createProject(
    name: string,
    preview: ImportPreview,
    mapping: Record<string, string>,
    setup?: ProjectSetup,
  ) {
    const id = randomUUID(),
      now = new Date().toISOString();
    const insertProject = this.db.prepare(
      "INSERT INTO projects VALUES (?, ?, ?, ?, NULL, ?, ?)",
    );
    const insertLead = this.db.prepare(
      `INSERT INTO leads (id,project_id,source_row_number,business_name,phone_raw,phone_normalized,wa_exists,confidence,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    const seen = new Set<string>();
    const readyLeadIds: string[] = [];
    const run = () =>
      this.transaction(() => {
        insertProject.run(
          id,
          name,
          preview.fileName,
          preview.selectedSheet,
          now,
          now,
        );
        preview.rows.forEach((row, index) => {
          const raw = String(row[mapping.phone] ?? "").trim();
          const businessName = String(row[mapping.business] ?? "").trim();
          const normalized = normalizePhone(raw);
          const duplicate = !!normalized && seen.has(normalized);
          if (normalized) seen.add(normalized);
          const leadId = randomUUID();
          insertLead.run(
            leadId,
            id,
            index + 2,
            businessName,
            raw,
            normalized,
            String(row[mapping.wa_exists] ?? ""),
            String(row[mapping.confidence] ?? ""),
            !businessName || !normalized || duplicate ? "needs_fix" : "unprocessed",
            now,
          );
          if (businessName && normalized && !duplicate) readyLeadIds.push(leadId);
        });
        const templateId = randomUUID();
        const templateName = setup?.templateName || "Sapaan siang";
        const templateBody =
          normalizeTemplate(setup?.templateBody) ||
          "Halo, selamat siang {business_name}. Saya Putra dari Grova...";
        this.db
          .prepare("INSERT INTO templates VALUES (?,?,?,?,?,?)")
          .run(templateId, id, templateName, templateBody, now, now);
        this.db
          .prepare("UPDATE projects SET active_template_id=? WHERE id=?")
          .run(templateId, id);
        if (setup) {
          const insertContainer = this.db.prepare(
            "INSERT INTO containers VALUES (?,?,?,?,?,?,?,?)",
          );
          setup.containers.forEach((container) =>
            insertContainer.run(
              id,
              container.cookieStoreId,
              container.name,
              container.color || "blue",
              container.icon || "fingerprint",
              container.selected ? 1 : 0,
              container.internalLabel || "",
              now,
            ),
          );
          const assign = this.db.prepare(
            "UPDATE leads SET assigned_container_id=?, updated_at=? WHERE id=?",
          );
          const remainingAllocation = setup.allocation.map(
            ({ containerId, count }) => ({
              containerId,
              remaining: Math.max(0, Math.floor(count)),
            }),
          );
          let allocationCursor = 0;
          for (const leadId of readyLeadIds) {
            let assigned = false;
            for (
              let attempt = 0;
              attempt < remainingAllocation.length;
              attempt++
            ) {
              const allocation = remainingAllocation[allocationCursor];
              allocationCursor =
                (allocationCursor + 1) % remainingAllocation.length;
              if (allocation.remaining === 0) continue;
              assign.run(allocation.containerId, now, leadId);
              allocation.remaining--;
              assigned = true;
              break;
            }
            if (!assigned) break;
          }
        }
      });
    run();
    return this.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM leads WHERE project_id=p.id) lead_count FROM projects p WHERE id=?`,
      )
      .get(id);
  }
  getSetup(): SetupPreferences {
    const settings = this.db
      .prepare("SELECT key,value FROM app_settings")
      .all() as Array<{ key: string; value: string }>;
    const values = Object.fromEntries(
      settings.map((item) => [item.key, item.value]),
    );
    const containers = this.db
      .prepare(
        "SELECT cookie_store_id cookieStoreId,display_name name,color,icon,is_selected selected,internal_label internalLabel FROM global_containers ORDER BY display_name",
      )
      .all() as unknown as FirefoxContainer[];
    return {
      templateName: values.template_name || "Template utama",
      templateBody:
        normalizeTemplate(values.template_body) ||
        "Halo, selamat siang {business_name}. Saya Putra dari Grova...",
      containers,
    };
  }
  getSheetExportConfig() {
    const rows = this.db
      .prepare(
        "SELECT key,value FROM app_settings WHERE key IN ('sheet_export_url','sheet_export_secret')",
      )
      .all() as Array<{ key: string; value: string }>;
    const values = Object.fromEntries(rows.map((item) => [item.key, item.value]));
    return {
      endpointUrl: values.sheet_export_url || "",
      secret: values.sheet_export_secret || "",
    };
  }
  saveSheetExportConfig(endpointUrl: string, secret?: string) {
    const statement = this.db.prepare(
      "INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    this.transaction(() => {
      statement.run("sheet_export_url", endpointUrl.trim());
      if (secret?.trim()) statement.run("sheet_export_secret", secret.trim());
    });
    return this.getSheetExportConfig();
  }
  getProjectForSheetExport(projectId: string) {
    const project = this.db
      .prepare("SELECT id,name,created_at FROM projects WHERE id=?")
      .get(projectId) as
      | { id: string; name: string; created_at: string }
      | undefined;
    if (!project) return null;
    const rows = this.db
      .prepare(
        `SELECT l.business_name businessName,l.phone_normalized phone,COALESCE(NULLIF(c.internal_label,''),c.display_name) accountName
         FROM leads l
         JOIN containers c ON c.project_id=l.project_id AND c.cookie_store_id=l.assigned_container_id
         WHERE l.project_id=? AND l.status!='needs_fix' AND l.phone_normalized IS NOT NULL
         ORDER BY (
           SELECT MIN(l2.source_row_number)
           FROM leads l2
           WHERE l2.project_id=l.project_id
             AND l2.assigned_container_id=l.assigned_container_id
             AND l2.status!='needs_fix'
             AND l2.phone_normalized IS NOT NULL
         ), l.source_row_number`,
      )
      .all(projectId);
    return {
      type: "export",
      projectId: project.id,
      projectName: project.name,
      createdAt: project.created_at,
      rows,
    };
  }
  saveSetupTemplate(name: string, body: string) {
    const statement = this.db.prepare(
      "INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    this.transaction(() => {
      statement.run("template_name", name);
      statement.run("template_body", normalizeTemplate(body));
    });
  }
  saveSetupContainers(items: FirefoxContainer[]) {
    const statement = this.db.prepare(
      `INSERT INTO global_containers VALUES (?,?,?,?,?,?,?) ON CONFLICT(cookie_store_id) DO UPDATE SET display_name=excluded.display_name,color=excluded.color,icon=excluded.icon,is_selected=excluded.is_selected,internal_label=excluded.internal_label,saved_at=excluded.saved_at`,
    );
    const syncLabels = this.db.prepare(
      "UPDATE containers SET internal_label=? WHERE cookie_store_id=?",
    );
    const now = new Date().toISOString();
    this.transaction(() =>
      items.forEach((item) => {
        statement.run(
          item.cookieStoreId,
          item.name,
          item.color || "blue",
          item.icon || "fingerprint",
          item.selected ? 1 : 0,
          item.internalLabel || "",
          now,
        );
        syncLabels.run(item.internalLabel || "", item.cookieStoreId);
      }),
    );
  }
  saveSetupContainer(item: FirefoxContainer) {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO global_containers VALUES (?,?,?,?,?,?,?) ON CONFLICT(cookie_store_id) DO UPDATE SET display_name=excluded.display_name,color=excluded.color,icon=excluded.icon,is_selected=excluded.is_selected,internal_label=excluded.internal_label,saved_at=excluded.saved_at`,
        )
        .run(
          item.cookieStoreId,
          item.name,
          item.color || "blue",
          item.icon || "fingerprint",
          item.selected ? 1 : 0,
          item.internalLabel || "",
          now,
        );
      this.db
        .prepare("UPDATE containers SET internal_label=? WHERE cookie_store_id=?")
        .run(item.internalLabel || "", item.cookieStoreId);
    });
  }
  deleteProject(id: string) {
    this.db.prepare("DELETE FROM projects WHERE id=?").run(id);
  }
  summary(projectId: string) {
    const rows = this.db
      .prepare(
        "SELECT status, COUNT(*) count FROM leads WHERE project_id=? GROUP BY status",
      )
      .all(projectId) as any[];
    const out: any = {
      total: 0,
      unprocessed: 0,
      opened: 0,
      sent: 0,
      skipped: 0,
      needs_fix: 0,
      unassigned: 0,
    };
    rows.forEach((r) => {
      out[r.status] = r.count;
      out.total += r.count;
    });
    out.unassigned = (
      this.db
        .prepare(
          "SELECT COUNT(*) count FROM leads WHERE project_id=? AND assigned_container_id IS NULL",
        )
        .get(projectId) as any
    ).count;
    return out;
  }
  listLeads(projectId: string, filters: Record<string, string> = {}) {
    const clauses = ["l.project_id=?"];
    const params: any[] = [projectId];
    if (filters.status) {
      clauses.push("l.status=?");
      params.push(filters.status);
    }
    if (filters.container === "unassigned")
      clauses.push("l.assigned_container_id IS NULL");
    else if (filters.container) {
      clauses.push("l.assigned_container_id=?");
      params.push(filters.container);
    }
    if (filters.search) {
      clauses.push("(l.business_name LIKE ? OR l.phone_raw LIKE ?)");
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    const order =
      filters.sort === "name"
        ? "l.business_name COLLATE NOCASE"
        : filters.sort === "status"
          ? "l.status"
          : "l.source_row_number";
    return this.db
      .prepare(
        `SELECT l.*, COALESCE(NULLIF(c.internal_label,''),c.display_name) container_name, REPLACE(REPLACE(COALESCE(t.body,''),'{nama_bisnis}',l.business_name),'{business_name}',l.business_name) message FROM leads l LEFT JOIN containers c ON c.project_id=l.project_id AND c.cookie_store_id=l.assigned_container_id LEFT JOIN projects p ON p.id=l.project_id LEFT JOIN templates t ON t.id=p.active_template_id WHERE ${clauses.join(" AND ")} ORDER BY ${order}`,
      )
      .all(...params);
  }
  assignLeads(ids: string[], containerId: string | null) {
    const stmt = this.db.prepare(
      "UPDATE leads SET assigned_container_id=?, updated_at=? WHERE id=?",
    );
    this.transaction(() =>
      ids.forEach((id) => stmt.run(containerId, new Date().toISOString(), id)),
    );
  }
  setStatus(id: string, status: LeadStatus, source = "user") {
    const lead = this.db
      .prepare("SELECT status,project_id FROM leads WHERE id=?")
      .get(id) as any;
    if (!lead) return;
    const now = new Date().toISOString();
    if (lead.status === status) {
      if (status === "opened")
        this.db
          .prepare("UPDATE leads SET opened_at=?,updated_at=? WHERE id=?")
          .run(now, now, id);
      return;
    }
    const opened = status === "opened" ? now : null;
    const sent = status === "sent" ? now : null;
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE leads SET status=?, opened_at=COALESCE(?,opened_at), marked_sent_at=CASE WHEN ?='sent' THEN ? WHEN ?!='sent' THEN NULL ELSE marked_sent_at END, updated_at=? WHERE id=?`,
        )
        .run(status, opened, status, sent, status, now, id);
      this.db
        .prepare("INSERT INTO status_audit VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), id, lead.status, status, now, source);
      this.db
        .prepare("UPDATE projects SET updated_at=? WHERE id=?")
        .run(now, lead.project_id);
    });
  }
  undo(projectId: string) {
    const audit = this.db
      .prepare(
        `SELECT a.* FROM status_audit a JOIN leads l ON l.id=a.lead_id WHERE l.project_id=? ORDER BY a.changed_at DESC, a.rowid DESC LIMIT 1`,
      )
      .get(projectId) as any;
    if (!audit) return;
    this.transaction(() => {
      this.db
        .prepare("UPDATE leads SET status=?, updated_at=? WHERE id=?")
        .run(audit.old_status, new Date().toISOString(), audit.lead_id);
      this.db.prepare("DELETE FROM status_audit WHERE id=?").run(audit.id);
    });
  }
  listAudit(projectId: string) {
    return this.db
      .prepare(
        `SELECT a.*,l.business_name FROM status_audit a JOIN leads l ON l.id=a.lead_id WHERE l.project_id=? ORDER BY a.changed_at DESC, a.rowid DESC LIMIT 100`,
      )
      .all(projectId);
  }
  listTemplates(projectId: string) {
    return this.db
      .prepare(
        `SELECT t.*, t.id=p.active_template_id active FROM templates t JOIN projects p ON p.id=t.project_id WHERE t.project_id=? ORDER BY t.updated_at DESC`,
      )
      .all(projectId);
  }
  saveTemplate(
    projectId: string,
    input: { id?: string; name: string; body: string },
  ) {
    const now = new Date().toISOString(),
      id = input.id || randomUUID(),
      body = normalizeTemplate(input.body);
    if (input.id)
      this.db
        .prepare(
          "UPDATE templates SET name=?,body=?,updated_at=? WHERE id=? AND project_id=?",
        )
        .run(input.name, body, now, id, projectId);
    else
      this.db
        .prepare("INSERT INTO templates VALUES (?,?,?,?,?,?)")
        .run(id, projectId, input.name, body, now, now);
    this.db
      .prepare(
        "UPDATE projects SET active_template_id=?,updated_at=? WHERE id=?",
      )
      .run(id, now, projectId);
    return this.db
      .prepare("SELECT *,1 active FROM templates WHERE id=?")
      .get(id);
  }
  activateTemplate(projectId: string, id: string) {
    this.db
      .prepare(
        "UPDATE projects SET active_template_id=?,updated_at=? WHERE id=?",
      )
      .run(id, new Date().toISOString(), projectId);
  }
  listContainers(projectId: string) {
    return this.db
      .prepare(
        `SELECT cookie_store_id cookieStoreId,display_name name,color,icon,is_selected selected,internal_label internalLabel FROM containers WHERE project_id=? ORDER BY display_name`,
      )
      .all(projectId);
  }
  saveContainers(projectId: string, items: FirefoxContainer[]) {
    const stmt = this.db.prepare(
      `INSERT INTO containers VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,cookie_store_id) DO UPDATE SET display_name=excluded.display_name,color=excluded.color,icon=excluded.icon,is_selected=excluded.is_selected,internal_label=excluded.internal_label,saved_at=excluded.saved_at`,
    );
    const now = new Date().toISOString();
    this.transaction(() =>
      items.forEach((i) =>
        stmt.run(
          projectId,
          i.cookieStoreId,
          i.name,
          i.color || "blue",
          i.icon || "fingerprint",
          i.selected ? 1 : 0,
          i.internalLabel || "",
          now,
        ),
      ),
    );
  }
  saveProjectContainer(projectId: string, item: FirefoxContainer) {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO containers VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,cookie_store_id) DO UPDATE SET display_name=excluded.display_name,color=excluded.color,icon=excluded.icon,is_selected=excluded.is_selected,internal_label=excluded.internal_label,saved_at=excluded.saved_at`,
        )
        .run(
          projectId,
          item.cookieStoreId,
          item.name,
          item.color || "blue",
          item.icon || "fingerprint",
          item.selected ? 1 : 0,
          item.internalLabel || "",
          now,
        );
      this.db
        .prepare("UPDATE containers SET internal_label=? WHERE cookie_store_id=?")
        .run(item.internalLabel || "", item.cookieStoreId);
      this.db
        .prepare(
          "UPDATE global_containers SET internal_label=?,saved_at=? WHERE cookie_store_id=?",
        )
        .run(item.internalLabel || "", now, item.cookieStoreId);
    });
  }
  getLeadForOpen(id: string) {
    return this.db
      .prepare(
        `SELECT l.*,c.cookie_store_id,REPLACE(REPLACE(COALESCE(t.body,''),'{nama_bisnis}',l.business_name),'{business_name}',l.business_name) message,t.body template_body FROM leads l LEFT JOIN containers c ON c.project_id=l.project_id AND c.cookie_store_id=l.assigned_container_id JOIN projects p ON p.id=l.project_id LEFT JOIN templates t ON t.id=p.active_template_id WHERE l.id=?`,
      )
      .get(id) as any;
  }
  backup(projectId: string) {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      project: this.db
        .prepare("SELECT * FROM projects WHERE id=?")
        .get(projectId),
      leads: this.db
        .prepare("SELECT * FROM leads WHERE project_id=?")
        .all(projectId),
      templates: this.db
        .prepare("SELECT * FROM templates WHERE project_id=?")
        .all(projectId),
      containers: this.db
        .prepare("SELECT * FROM containers WHERE project_id=?")
        .all(projectId),
      audit: this.listAudit(projectId),
    };
  }
}
export function normalizePhone(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  else if (digits.startsWith("8")) digits = "62" + digits;
  if (!/^\d{8,15}$/.test(digits)) return null;
  return digits;
}
function normalizeTemplate(input?: string) {
  return String(input || "").replaceAll("{nama_bisnis}", "{business_name}");
}
