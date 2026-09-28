export type LeadStatus =
  "unprocessed" | "opened" | "sent" | "skipped" | "needs_fix";

export interface Project {
  id: string;
  name: string;
  source_file_name: string;
  source_sheet_name: string;
  created_at: string;
  updated_at: string;
  lead_count: number;
}
export interface Lead {
  id: string;
  project_id: string;
  source_row_number: number;
  business_name: string;
  phone_raw: string;
  phone_normalized: string | null;
  wa_exists: string;
  confidence: string;
  assigned_container_id: string | null;
  status: LeadStatus;
  opened_at: string | null;
  marked_sent_at: string | null;
  updated_at: string;
  container_name?: string;
  message?: string;
}
export interface FirefoxContainer {
  cookieStoreId: string;
  name: string;
  color: string;
  icon: string;
  selected?: boolean;
  internalLabel?: string;
}
export interface MessageTemplate {
  id: string;
  project_id: string;
  name: string;
  body: string;
  active: boolean;
  updated_at: string;
}
export interface ImportPreview {
  filePath: string;
  fileName: string;
  sheets: string[];
  selectedSheet: string;
  headers: string[];
  suggestedMapping: Record<string, string>;
  rows: Record<string, string>[];
  summary: {
    total: number;
    ready: number;
    missing: number;
    missingBusiness: number;
    duplicates: number;
  };
}
export interface DashboardSummary {
  total: number;
  unprocessed: number;
  opened: number;
  sent: number;
  skipped: number;
  needs_fix: number;
  unassigned: number;
}
export interface AuditItem {
  id: string;
  lead_id: string;
  business_name: string;
  old_status: LeadStatus;
  new_status: LeadStatus;
  changed_at: string;
  source: string;
}
export interface AppSettings {
  addonToken: string;
  bridgePort: number;
  addonConnected: boolean;
  addonVersion: string | null;
  firefoxAvailable: boolean;
}

export interface SetupPreferences {
  templateName: string;
  templateBody: string;
  containers: FirefoxContainer[];
}

export interface ProjectSetup {
  templateName: string;
  templateBody: string;
  containers: FirefoxContainer[];
  allocation: Array<{ containerId: string; count: number }>;
}

export interface DesktopApi {
  projects: {
    list(): Promise<Project[]>;
    create(input: {
      name: string;
      preview: ImportPreview;
      mapping: Record<string, string>;
      setup?: ProjectSetup;
    }): Promise<Project>;
    delete(id: string): Promise<void>;
    exportBackup(id: string): Promise<string | null>;
  };
  importExcel: {
    choose(): Promise<ImportPreview | null>;
    sheet(filePath: string, sheet: string): Promise<ImportPreview>;
  };
  dashboard: { summary(projectId: string): Promise<DashboardSummary> };
  leads: {
    list(projectId: string, filters?: Record<string, string>): Promise<Lead[]>;
    assign(ids: string[], containerId: string | null): Promise<void>;
    status(id: string, status: LeadStatus, source?: string): Promise<void>;
    undo(projectId: string): Promise<void>;
  };
  templates: {
    list(projectId: string): Promise<MessageTemplate[]>;
    save(
      projectId: string,
      input: { id?: string; name: string; body: string },
    ): Promise<MessageTemplate>;
    activate(projectId: string, id: string): Promise<void>;
  };
  containers: {
    list(projectId: string): Promise<FirefoxContainer[]>;
    save(projectId: string, items: FirefoxContainer[]): Promise<void>;
    saveOne(projectId: string, item: FirefoxContainer): Promise<void>;
    refresh(): Promise<FirefoxContainer[]>;
  };
  setup: {
    get(): Promise<SetupPreferences>;
    saveTemplate(name: string, body: string): Promise<void>;
    saveContainers(items: FirefoxContainer[]): Promise<void>;
    saveContainer(item: FirefoxContainer): Promise<void>;
  };
  firefox: {
    settings(): Promise<AppSettings>;
    onStatus(listener: (settings: AppSettings) => void): () => void;
    openChat(leadId: string): Promise<{ ok: boolean; error?: string }>;
    copy(text: string): Promise<void>;
  };
  audit: { list(projectId: string): Promise<AuditItem[]> };
}
