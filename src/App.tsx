import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  MessageSquareText,
  Boxes,
  Play,
  History,
  FilePlus2,
  FolderOpen,
  Search,
  Undo2,
  Download,
  RefreshCw,
  Copy,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  FileSpreadsheet,
  Settings2,
} from "lucide-react";
import type {
  AppSettings,
  AuditItem,
  DashboardSummary,
  FirefoxContainer,
  ImportPreview,
  Lead,
  LeadStatus,
  MessageTemplate,
  Project,
  SheetExportSettings,
} from "../shared/types";

type View =
  "dashboard" | "leads" | "templates" | "containers" | "queue" | "audit";
const statusLabel: Record<LeadStatus, string> = {
  unprocessed: "Belum diproses",
  opened: "Chat dibuka",
  sent: "Terkirim",
  skipped: "Lewati",
  needs_fix: "Perlu diperbaiki",
};
const emptySummary: DashboardSummary = {
  total: 0,
  unprocessed: 0,
  opened: 0,
  sent: 0,
  skipped: 0,
  needs_fix: 0,
  unassigned: 0,
};
function renderTemplate(body: string, businessName = "Toko Maju Jaya") {
  return body
    .replaceAll("{nama_bisnis}", businessName)
    .replaceAll("{business_name}", businessName);
}
function addonVersionCompatible(version: string | null | undefined) {
  const [major, minor] = String(version || "")
    .split(".")
    .map((part) => Number(part));
  return major > 1 || (major === 1 && minor >= 1);
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [settings, setSettings] = useState<AppSettings | null>(null);
  const loadProjects = async () => {
    const p = await window.desktop.projects.list();
    setProjects(p);
    if (project) setProject(p.find((x) => x.id === project.id) || null);
  };
  useEffect(() => {
    const refreshSettings = () =>
      window.desktop.firefox.settings().then(setSettings);
    Promise.all([
      window.desktop.projects.list(),
      window.desktop.firefox.settings(),
    ]).then(([p, s]) => {
      setProjects(p);
      setSettings(s);
    });
    const unsubscribe = window.desktop.firefox.onStatus(setSettings);
    const fallback = setInterval(refreshSettings, 10000);
    return () => {
      unsubscribe();
      clearInterval(fallback);
    };
  }, []);
  useEffect(() => {
    if (project) localStorage.setItem("lastProject", project.id);
  }, [project]);
  if (!project)
    return (
      <StartScreen
        projects={projects}
        settings={settings}
        onOpen={setProject}
        onCreated={async (p) => {
          await loadProjects();
          setProject(p);
        }}
      />
    );
  return (
    <OperationalLeads
      project={project}
      settings={settings}
      onBack={() => setProject(null)}
    />
  );
  /* Legacy project views are retained below for data compatibility.
  const nav = [
    ["dashboard", LayoutDashboard, "Ringkasan"],
    ["leads", Users, "Pembagian lead"],
    ["templates", MessageSquareText, "Template"],
    ["containers", Boxes, "Firefox Containers"],
    ["queue", Play, "Antrean kerja"],
    ["audit", History, "Riwayat status"],
  ] as const;
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brandmark">D</div>
          <div>
            <strong>Dashboard Draft WA</strong>
            <small>Lokal di komputer ini</small>
          </div>
        </div>
        <button className="project-switch" onClick={() => setProject(null)}>
          <FolderOpen size={17} />
          <span>{project.name}</span>
          <ChevronRight size={15} />
        </button>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className={`connection ${settings?.addonConnected ? "ok" : ""}`}>
            {settings?.addonConnected ? (
              <CheckCircle2 size={17} />
            ) : (
              <WifiOff size={17} />
            )}
            <div>
              <b>
                {settings?.addonConnected
                  ? "Add-on terhubung"
                  : "Add-on belum terhubung"}
              </b>
              <small>
                {settings?.firefoxAvailable
                  ? "Firefox tersedia"
                  : "Firefox tidak ditemukan"}
              </small>
            </div>
          </div>
          <p>
            Pesan hanya terkirim saat Anda menekan Kirim sendiri di WhatsApp.
          </p>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <h1>{nav.find((n) => n[0] === view)?.[2]}</h1>
            <p>
              {project.source_file_name} · {project.lead_count} lead
            </p>
          </div>
          <div className="header-actions">
            <button
              className="ghost"
              onClick={async () => {
                await window.desktop.projects.exportBackup(project.id);
                flash("Backup proyek berhasil diekspor");
              }}
            >
              <Download size={17} />
              Ekspor backup
            </button>
          </div>
        </header>
        {notice && <div className="toast">{notice}</div>}
        <section className="content">
          {view === "dashboard" && <Dashboard project={project} go={setView} />}{" "}
          {view === "leads" && <Leads project={project} flash={flash} />}{" "}
          {view === "templates" && (
            <Templates project={project} flash={flash} />
          )}{" "}
          {view === "containers" && (
            <Containers project={project} settings={settings} flash={flash} />
          )}{" "}
          {view === "queue" && (
            <Queue
              project={project}
              connected={!!settings?.addonConnected}
              flash={flash}
            />
          )}{" "}
          {view === "audit" && <Audit project={project} flash={flash} />}
        </section>
      </main>
    </div>
  );
  */
}

function OperationalLeads({
  project,
  settings,
  onBack,
}: {
  project: Project;
  settings: AppSettings | null;
  onBack: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]),
    [allLeads, setAllLeads] = useState<Lead[]>([]),
    [containers, setContainers] = useState<FirefoxContainer[]>([]),
    [search, setSearch] = useState(""),
    [status, setStatusFilter] = useState(""),
    [container, setContainerFilter] = useState(""),
    [openingId, setOpeningId] = useState(""),
    [notice, setNotice] = useState(""),
    [delaySeconds, setDelaySeconds] = useState(60),
    [now, setNow] = useState(Date.now()),
    [sheetSettings, setSheetSettings] = useState<SheetExportSettings | null>(null),
    [showSheetSettings, setShowSheetSettings] = useState(false),
    [sheetEndpoint, setSheetEndpoint] = useState(""),
    [sheetSecret, setSheetSecret] = useState(""),
    [savingSheetSettings, setSavingSheetSettings] = useState(false),
    [exportingSheet, setExportingSheet] = useState(false);

  const load = () =>
    Promise.all([
      window.desktop.leads.list(project.id, {
        search,
        status,
        container,
        sort: "number",
      }),
      window.desktop.leads.list(project.id, { sort: "number" }),
      window.desktop.containers.list(project.id),
    ]).then(([leadItems, everyLead, containerItems]) => {
      setLeads(leadItems);
      setAllLeads(everyLead);
      setContainers(containerItems);
    });

  useEffect(() => {
    load();
  }, [project.id, search, status, container]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    window.desktop.sheet.settings().then((saved) => {
      setSheetSettings(saved);
      setSheetEndpoint(saved.endpointUrl);
    });
  }, []);

  const lastOpened = allLeads.reduce<string | null>((latest, lead) => {
    if (!lead.opened_at) return latest;
    return !latest || new Date(lead.opened_at) > new Date(latest)
      ? lead.opened_at
      : latest;
  }, null);
  const elapsed = lastOpened
    ? Math.max(0, Math.floor((now - new Date(lastOpened).getTime()) / 1000))
    : null;
  const waitLeft = elapsed === null ? 0 : Math.max(0, delaySeconds - elapsed);
  const openedCount = allLeads.filter((lead) => !!lead.opened_at).length;
  const addonReady =
    !!settings?.addonConnected && addonVersionCompatible(settings.addonVersion);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 3000);
  };
  const openLead = async (lead: Lead) => {
    if (!addonReady) {
      flash(
        settings?.addonConnected
          ? "Pasang atau muat ulang add-on Firefox versi terbaru."
          : "Add-on Firefox belum terhubung.",
      );
      return;
    }
    setOpeningId(lead.id);
    const result = await window.desktop.firefox.openChat(lead.id);
    setOpeningId("");
    if (!result.ok) {
      flash(result.error || "Chat gagal dibuka.");
      return;
    }
    await load();
    setNow(Date.now());
    flash(`Chat ${lead.business_name} dibuka.`);
  };
  const formatElapsed = (seconds: number) => {
    if (seconds < 60) return `${seconds} detik lalu`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} menit ${seconds % 60} detik lalu`;
  };
  const saveSheetSettings = async () => {
    setSavingSheetSettings(true);
    try {
      const saved = await window.desktop.sheet.saveSettings({
        endpointUrl: sheetEndpoint,
        secret: sheetSecret || undefined,
      });
      setSheetSettings(saved);
      setSheetSecret("");
      const tested = await window.desktop.sheet.test();
      if (!tested.ok) {
        flash(`Pengaturan disimpan, tetapi koneksi gagal: ${tested.error}`);
        return;
      }
      setShowSheetSettings(false);
      flash("Google Sheet terhubung.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Pengaturan gagal disimpan.");
    } finally {
      setSavingSheetSettings(false);
    }
  };
  const exportToSheet = async () => {
    if (!sheetSettings?.configured) {
      setShowSheetSettings(true);
      flash("Atur koneksi Google Sheet terlebih dahulu.");
      return;
    }
    setExportingSheet(true);
    const result = await window.desktop.sheet.exportProject(project.id);
    setExportingSheet(false);
    if (!result.ok) {
      flash(result.error || "Ekspor Google Sheet gagal.");
      return;
    }
    if (result.alreadyExported) {
      flash(
        `Proyek ini sudah diekspor ke ${result.sheetName}, baris ${result.startRow}–${result.endRow}.`,
      );
      return;
    }
    flash(
      `${result.rowCount} lead ditambahkan ke ${result.sheetName}, baris ${result.startRow}–${result.endRow}.`,
    );
  };

  return (
    <div className="operations-page">
      {notice && <div className="toast">{notice}</div>}
      <header className="operations-header">
        <button className="ghost back-button" onClick={onBack}>
          <ChevronLeft size={19} /> Kembali
        </button>
        <div className="operations-project">
          <h1>Pembagian lead</h1>
          <p>{project.source_file_name} · {project.lead_count} lead</p>
        </div>
        <div className="operations-header-actions">
          <button
            className="primary sheet-export-button"
            disabled={exportingSheet}
            onClick={exportToSheet}
          >
            <FileSpreadsheet size={17} />
            {exportingSheet ? "Mengekspor…" : "Export ke Google Sheet"}
          </button>
          <button
            className="ghost sheet-settings-button"
            aria-label="Atur Google Sheet"
            title="Atur Google Sheet"
            onClick={() => setShowSheetSettings((current) => !current)}
          >
            <Settings2 size={17} />
          </button>
          <div className={`operations-connection ${addonReady ? "connected" : ""}`}>
            {addonReady ? <CheckCircle2 size={17} /> : <WifiOff size={17} />}
            {addonReady
              ? "Firefox terhubung"
              : settings?.addonConnected
                ? "Reload add-on"
                : "Belum terhubung"}
          </div>
        </div>
      </header>

      {showSheetSettings && (
        <section className="sheet-export-settings">
          <div className="sheet-export-settings-title">
            <div>
              <b>Koneksi Google Sheet</b>
              <small>Pengaturan disimpan lokal di komputer ini.</small>
            </div>
            <button className="ghost" onClick={() => setShowSheetSettings(false)}>Tutup</button>
          </div>
          <label>
            URL Apps Script
            <input
              value={sheetEndpoint}
              onChange={(event) => setSheetEndpoint(event.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
            />
          </label>
          <label>
            Secret
            <input
              type="password"
              value={sheetSecret}
              onChange={(event) => setSheetSecret(event.target.value)}
              placeholder={sheetSettings?.hasSecret ? "Tersimpan — kosongkan jika tidak diubah" : "Minimal 32 karakter"}
            />
          </label>
          <button
            className="primary"
            disabled={savingSheetSettings}
            onClick={saveSheetSettings}
          >
            {savingSheetSettings ? "Menguji koneksi…" : "Simpan dan uji koneksi"}
          </button>
        </section>
      )}

      <section className="operations-controls">
        <label className="operations-search">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama bisnis atau nomor" />
        </label>
        <select value={container} onChange={(event) => setContainerFilter(event.target.value)}>
          <option value="">Semua container</option>
          {containers.filter((item) => item.selected).map((item) => (
            <option value={item.cookieStoreId} key={item.cookieStoreId}>{item.internalLabel || item.name}</option>
          ))}
        </select>
        <select value={status} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Semua status</option>
          <option value="unprocessed">Belum diproses</option>
          <option value="opened">Chat dibuka</option>
          <option value="sent">Terkirim</option>
          <option value="skipped">Lewati</option>
          <option value="needs_fix">Perlu diperbaiki</option>
        </select>
        <label className="delay-control">
          Jeda
          <select value={delaySeconds} onChange={(event) => setDelaySeconds(Number(event.target.value))}>
            <option value={30}>30 detik</option>
            <option value={60}>60 detik</option>
            <option value={90}>90 detik</option>
            <option value={120}>120 detik</option>
          </select>
        </label>
      </section>

      <section className={`operations-timing ${lastOpened && waitLeft > 0 ? "waiting" : "ready"}`}>
        <div>
          <b>{lastOpened ? new Date(lastOpened).toLocaleTimeString("id-ID") : "Belum ada chat dibuka"}</b>
          <span>{elapsed === null ? "Waktu pembukaan akan tercatat otomatis" : formatElapsed(elapsed)}</span>
        </div>
        <div className="timing-state">
          {lastOpened && waitLeft > 0 ? `Saran tunggu ${waitLeft} detik` : "Siap membuka berikutnya"}
        </div>
        <small>{openedCount} dari {project.lead_count} lead sudah dibuka</small>
      </section>

      <main className="operations-list">
        {leads.map((lead, index) => {
          const canOpen = addonReady && !!lead.phone_normalized && !!lead.assigned_container_id && lead.status !== "needs_fix";
          const openedElapsed = lead.opened_at
            ? Math.max(0, Math.floor((now - new Date(lead.opened_at).getTime()) / 1000))
            : null;
          return (
            <article className={`operational-lead ${lead.status}`} key={lead.id}>
              <div className="lead-identity">
                <small>LEAD {String(index + 1).padStart(2, "0")}</small>
                <b>{lead.business_name || "Nama bisnis belum diisi"}</b>
                <span>{lead.phone_normalized || lead.phone_raw || "Nomor belum tersedia"}</span>
              </div>
              <div className="lead-container">
                <small>CONTAINER</small>
                <b>{lead.container_name || "Belum dialokasikan"}</b>
              </div>
              <div className="lead-activity">
                <span className={`status ${lead.status}`}>{statusLabel[lead.status]}</span>
                <b>{lead.opened_at ? new Date(lead.opened_at).toLocaleTimeString("id-ID") : "Belum dibuka"}</b>
                {openedElapsed !== null && <small>{formatElapsed(openedElapsed)}</small>}
              </div>
              <button className="primary lead-open-button" disabled={!canOpen || openingId === lead.id} onClick={() => openLead(lead)}>
                <ExternalLink size={17} />
                {openingId === lead.id ? "Membuka…" : lead.opened_at ? "Buka lagi" : "Buka chat"}
              </button>
            </article>
          );
        })}
        {leads.length === 0 && (
          <div className="empty big"><Search size={30} /><b>Tidak ada lead yang cocok</b></div>
        )}
      </main>
    </div>
  );
}

function StartScreen({
  projects,
  settings,
  onOpen,
  onCreated,
}: {
  projects: Project[];
  settings: AppSettings | null;
  onOpen: (p: Project) => void;
  onCreated: (p: Project) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null),
    [name, setName] = useState(""),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [templateName, setTemplateName] = useState("Template utama"),
    [templateBody, setTemplateBody] = useState(""),
    [editingTemplate, setEditingTemplate] = useState(false),
    [containers, setContainers] = useState<FirefoxContainer[]>([]),
    [containerQuery, setContainerQuery] = useState(""),
    [containersCollapsed, setContainersCollapsed] = useState(false),
    [connectionWaitExpired, setConnectionWaitExpired] = useState(false),
    [loadingContainers, setLoadingContainers] = useState(false),
    [creatingQueue, setCreatingQueue] = useState(false),
    [allocationMode, setAllocationMode] = useState<"even" | "custom">("even"),
    [quotas, setQuotas] = useState<Record<string, number>>({}),
    [notice, setNotice] = useState("");

  const selectedContainers = containers.filter((item) => item.selected);
  const previewBusinessName =
    preview && mapping.business
      ? String(
          preview.rows.find((row) =>
            String(row[mapping.business] ?? "").trim(),
          )?.[mapping.business] || "Toko Maju Jaya",
        )
      : "Toko Maju Jaya";
  const visibleContainers = [...containers]
    .filter((item) =>
      `${item.name} ${item.internalLabel || ""}`
        .toLowerCase()
        .includes(containerQuery.trim().toLowerCase()),
    )
    .sort((a, b) => Number(!!b.selected) - Number(!!a.selected));
  const previewSummary = (() => {
    if (!preview)
      return { total: 0, ready: 0, invalidPhone: 0, missingBusiness: 0, duplicates: 0 };
    const seen = new Set<string>();
    let ready = 0,
      invalidPhone = 0,
      missingBusiness = 0,
      duplicates = 0;
    preview.rows.forEach((row) => {
      const business = String(row[mapping.business] ?? "").trim();
      let phone = String(row[mapping.phone] ?? "").replace(/\D/g, "");
      if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
      else if (phone.startsWith("8")) phone = `62${phone}`;
      const validPhone = /^\d{8,15}$/.test(phone);
      if (!business) missingBusiness++;
      if (!validPhone) invalidPhone++;
      const duplicate = validPhone && seen.has(phone);
      if (duplicate) duplicates++;
      if (validPhone) seen.add(phone);
      if (business && validPhone && !duplicate) ready++;
    });
    return { total: preview.rows.length, ready, invalidPhone, missingBusiness, duplicates };
  })();
  const evenAllocation = (total: number) =>
    selectedContainers.map((item, index) => ({
      containerId: item.cookieStoreId,
      count:
        selectedContainers.length === 0
          ? 0
          : Math.floor(total / selectedContainers.length) +
            (index < total % selectedContainers.length ? 1 : 0),
    }));
  const allocation = preview
    ? allocationMode === "even"
      ? evenAllocation(previewSummary.ready)
      : selectedContainers.map((item) => ({
          containerId: item.cookieStoreId,
          count: Math.max(0, Number(quotas[item.cookieStoreId] || 0)),
        }))
    : [];
  const allocatedTotal = allocation.reduce((sum, item) => sum + item.count, 0);
  const remainingTotal = previewSummary.ready - allocatedTotal;
  const evenQuotaMap = () =>
    Object.fromEntries(
      evenAllocation(previewSummary.ready).map((item) => [
        item.containerId,
        item.count,
      ]),
    );
  const setQuota = (containerId: string, value: number) =>
    setQuotas((current) => ({
      ...current,
      [containerId]: Math.max(0, Math.floor(Number(value) || 0)),
    }));
  const distributeRemaining = () => {
    if (remainingTotal <= 0 || selectedContainers.length === 0) return;
    const base = Math.floor(remainingTotal / selectedContainers.length);
    const extra = remainingTotal % selectedContainers.length;
    setQuotas((current) =>
      Object.fromEntries(
        selectedContainers.map((item, index) => [
          item.cookieStoreId,
          Math.max(0, Number(current[item.cookieStoreId] || 0)) +
            base +
            (index < extra ? 1 : 0),
        ]),
      ),
    );
  };

  const loadContainers = async () => {
    setLoadingContainers(true);
    try {
      const saved = await window.desktop.setup.get();
      let items = saved.containers;
      if (settings?.addonConnected) {
        const live = await window.desktop.containers.refresh();
        const previous = new Map(
          saved.containers.map((item) => [item.cookieStoreId, item]),
        );
        items = live.map((item) => {
          const savedItem = previous.get(item.cookieStoreId);
          return {
            ...item,
            selected: savedItem ? !!savedItem.selected : true,
            internalLabel: savedItem?.internalLabel || "",
          };
        });
        await window.desktop.setup.saveContainers(items);
      }
      setContainers(items);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Container gagal dimuat",
      );
    } finally {
      setLoadingContainers(false);
    }
  };

  useEffect(() => {
    window.desktop.setup.get().then((saved) => {
      setTemplateName(saved.templateName);
      setTemplateBody(saved.templateBody);
      setContainers(saved.containers);
    });
  }, []);
  useEffect(() => {
    if (settings?.addonConnected) {
      setConnectionWaitExpired(false);
      return;
    }
    const timer = setTimeout(() => setConnectionWaitExpired(true), 6000);
    return () => clearTimeout(timer);
  }, [settings?.addonConnected]);
  useEffect(() => {
    if (settings?.addonConnected) loadContainers();
  }, [settings?.addonConnected]);

  const choose = async () => {
    const p = await window.desktop.importExcel.choose();
    if (p) {
      setPreview(p);
      setName(p.fileName.replace(/\.xlsx$/i, ""));
      setMapping(p.suggestedMapping);
      setContainersCollapsed(true);
    }
  };
  const changeSheet = async (s: string) => {
    if (!preview) return;
    const p = await window.desktop.importExcel.sheet(preview.filePath, s);
    setPreview(p);
    setMapping(p.suggestedMapping);
  };
  const create = async () => {
    if (!preview) {
      setNotice("Pilih file Excel terlebih dahulu.");
      return;
    }
    if (!name.trim()) {
      setNotice("Nama proyek tidak boleh kosong.");
      return;
    }
    if (!mapping.business || !mapping.phone) {
      setNotice("Pilih kolom Business Name dan Nomor WhatsApp.");
      return;
    }
    if (!templateBody.trim()) {
      setNotice("Isi template terlebih dahulu.");
      return;
    }
    if (selectedContainers.length === 0) {
      setNotice("Pilih minimal satu container.");
      return;
    }
    if (allocatedTotal !== previewSummary.ready) {
      setNotice(
        `Jumlah pembagian harus ${previewSummary.ready} lead. Saat ini ${allocatedTotal}.`,
      );
      return;
    }
    if (previewSummary.ready === 0) {
      setNotice("Tidak ada lead valid untuk dibuat menjadi antrean.");
      return;
    }
    setCreatingQueue(true);
    setNotice("");
    try {
      await Promise.all([
        window.desktop.setup.saveTemplate(templateName, templateBody),
        window.desktop.setup.saveContainers(containers),
      ]);
      const p = await window.desktop.projects.create({
        name: name.trim(),
        preview,
        mapping,
        setup: {
          templateName,
          templateBody,
          containers,
          allocation,
        },
      });
      onCreated(p);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Antrean gagal dibuat: ${error.message}`
          : "Antrean gagal dibuat. Silakan coba lagi.",
      );
    } finally {
      setCreatingQueue(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateBody.trim()) {
      setNotice("Template tidak boleh kosong.");
      return;
    }
    await window.desktop.setup.saveTemplate(templateName, templateBody);
    const saved = await window.desktop.setup.get();
    setTemplateName(saved.templateName);
    setTemplateBody(saved.templateBody);
    setEditingTemplate(false);
    setNotice("Template utama disimpan.");
  };

  const updateContainer = async (
    cookieStoreId: string,
    change: Partial<FirefoxContainer>,
  ) => {
    const current = containers.find(
      (item) => item.cookieStoreId === cookieStoreId,
    );
    if (!current) return;
    const updated = { ...current, ...change };
    setContainers((items) =>
      items.map((item) =>
        item.cookieStoreId === cookieStoreId ? updated : item,
      ),
    );
    await window.desktop.setup.saveContainer(updated);
  };

  return (
    <div className="setup-page">
      <div className="setup-header">
        <div className="brand">
          <div className="brandmark">D</div>
          <div>
            <strong>Dashboard Draft WA</strong>
          </div>
        </div>
        <div className="setup-header-actions">
          {projects[0] && (
            <button className="ghost" onClick={() => onOpen(projects[0])}>
              <FolderOpen size={17} /> Buka proyek terakhir
            </button>
          )}
          <div className={`pill ${settings?.addonConnected ? "green" : ""}`}>
            {settings?.addonConnected
              ? "Firefox terhubung"
              : "Add-on belum terhubung"}
          </div>
        </div>
      </div>
      {notice && <div className="toast">{notice}</div>}
      <main className="setup-main">
        <div className="setup-workspace">
          <section className={`setup-card container-setup ${containersCollapsed ? "is-collapsed" : ""}`}>
            <div className="setup-card-title">
              <div>
                <h2>Container</h2>
                <p>{selectedContainers.length} dipilih dari {containers.length}</p>
              </div>
              <div className="setup-card-actions">
                <button
                  className="ghost container-collapse-toggle"
                  onClick={() => setContainersCollapsed((current) => !current)}
                >
                  {containersCollapsed ? "Atur" : "Ringkas"}
                </button>
                <button
                  className="secondary"
                  disabled={!settings?.addonConnected || loadingContainers}
                  onClick={loadContainers}
                >
                  <RefreshCw size={16} />
                  {loadingContainers ? "Memuat…" : "Muat ulang"}
                </button>
              </div>
            </div>
            {!settings?.addonConnected && (
              <div className="warning connection-help">
                <WifiOff size={17} />
                <div>
                  <b>{connectionWaitExpired ? "Companion Firefox belum aktif" : "Menyambungkan ke Firefox…"}</b>
                  <p>
                    {connectionWaitExpired
                      ? "Companion belum terdeteksi. Pastikan add-on permanen terpasang dan Firefox terbuka."
                      : "Menunggu add-on menyambung otomatis. Biasanya selesai dalam beberapa detik."}
                  </p>
                  {connectionWaitExpired && (
                    <details>
                      <summary>Atur ulang koneksi</summary>
                      <p>
                        Simpan token <code>{settings?.addonToken}</code> dengan port{" "}
                        <code>{settings?.bridgePort || 47921}</code> di pengaturan add-on Firefox.
                      </p>
                    </details>
                  )}
                </div>
              </div>
            )}
            <label className="container-search">
              <Search size={16} />
              <input
                value={containerQuery}
                onChange={(event) => setContainerQuery(event.target.value)}
                placeholder="Cari container"
              />
            </label>
            <div className="setup-container-list">
              {visibleContainers.map((item) => (
                <div className="setup-container-row" key={item.cookieStoreId}>
                  <input
                    type="checkbox"
                    checked={!!item.selected}
                    onChange={(event) =>
                      updateContainer(item.cookieStoreId, {
                        selected: event.target.checked,
                      })
                    }
                  />
                  <span className={`container-dot ${item.color}`} />
                  <div>
                    <b>{item.name}</b>
                  </div>
                  <input
                    placeholder="Nama akun"
                    title={item.cookieStoreId}
                    value={item.internalLabel || ""}
                    onChange={(event) =>
                      updateContainer(item.cookieStoreId, {
                        internalLabel: event.target.value,
                      })
                    }
                  />
                </div>
              ))}
              {containers.length === 0 && (
                <div className="empty compact">
                  <Boxes size={25} />
                  <b>Belum ada container</b>
                  <span>Hubungkan add-on Firefox untuk memuat daftar.</span>
                </div>
              )}
            </div>
            <div className="selected-count">
              {selectedContainers.length} container dipilih
            </div>
          </section>

          <div className={`setup-right ${preview ? "has-preview" : ""}`}>
            <section className={`setup-card template-setup ${preview ? "compact-template" : ""}`}>
              <div className="setup-card-title">
                <div>
                  <h2>Template pesan</h2>
                  <p>{templateName}</p>
                </div>
                <button className="secondary" onClick={() => setEditingTemplate(true)}>
                  <MessageSquareText size={16} /> Atur
                </button>
              </div>
              <div className="template-summary">
                <p>
                  {renderTemplate(templateBody, previewBusinessName)}
                </p>
              </div>
            </section>

            <section className="setup-card import-setup">
              <div className="setup-card-title">
                <div>
                  <h2>File Excel</h2>
                  <p>{preview ? preview.fileName : "Kolom Business Name dikenali otomatis"}</p>
                </div>
                {preview && <button className="ghost" onClick={choose}>Ganti file</button>}
              </div>
              {!preview ? (
                <button
                  className="dropzone setup-dropzone"
                  onClick={choose}
                  disabled={selectedContainers.length === 0}
                >
                  <FilePlus2 size={25} />
                  <b>Pilih file Excel</b>
                  <span>{selectedContainers.length ? "Format .xlsx" : "Pilih container terlebih dahulu"}</span>
                </button>
              ) : (
                <div className="import-content">
                  <div className="import-file-row">
                    <label>
                      Nama proyek
                      <input value={name} onChange={(e) => setName(e.target.value)} />
                    </label>
                    <label>
                      Sheet
                      <select value={preview.selectedSheet} onChange={(e) => changeSheet(e.target.value)}>
                        {preview.sheets.map((sheet) => <option key={sheet}>{sheet}</option>)}
                      </select>
                    </label>
                  </div>
                  <details className="mapping-details">
                    <summary>Pemetaan kolom</summary>
                    <div className="form-grid">
                      <label>
                        Business Name
                        <select value={mapping.business} onChange={(e) => setMapping({ ...mapping, business: e.target.value })}>
                          <option value="">Pilih kolom</option>
                          {preview.headers.map((header) => <option key={header}>{header}</option>)}
                        </select>
                      </label>
                      <label>
                        Nomor WhatsApp
                        <select value={mapping.phone} onChange={(e) => setMapping({ ...mapping, phone: e.target.value })}>
                          <option value="">Pilih kolom</option>
                          {preview.headers.map((header) => <option key={header}>{header}</option>)}
                        </select>
                      </label>
                    </div>
                  </details>
                  <div className="import-summary compact-summary">
                    <div><b>{previewSummary.total}</b><span>Total</span></div>
                    <div><b>{previewSummary.ready}</b><span>Siap</span></div>
                    <div className="warn"><b>{previewSummary.missingBusiness}</b><span>Tanpa nama</span></div>
                    <div className="warn"><b>{previewSummary.invalidPhone}</b><span>Nomor salah</span></div>
                    <div className="warn"><b>{previewSummary.duplicates}</b><span>Duplikat</span></div>
                  </div>
                  <div className="allocation-header expanded-allocation-header">
                    <div>
                      <h3>Pembagian lead</h3>
                      <p>{selectedContainers.length} container aktif</p>
                    </div>
                    <div className="segmented allocation-tabs">
                      <button className={allocationMode === "even" ? "active" : ""} onClick={() => setAllocationMode("even")}>Otomatis</button>
                      <button
                        className={allocationMode === "custom" ? "active" : ""}
                        onClick={() => {
                          setQuotas(evenQuotaMap());
                          setAllocationMode("custom");
                        }}
                      >Manual</button>
                    </div>
                  </div>
                  {allocationMode === "custom" && (
                    <div className="allocation-tools">
                      <button disabled={remainingTotal <= 0} onClick={distributeRemaining}>Bagi sisa rata</button>
                      <button onClick={() => setQuotas(evenQuotaMap())}>Reset rata</button>
                      <button onClick={() => setQuotas({})}>Kosongkan</button>
                    </div>
                  )}
                  <div className={`quota-list operational-quota-list ${allocationMode}`}>
                    {selectedContainers.map((item) => {
                      const proposed = allocation.find((entry) => entry.containerId === item.cookieStoreId)?.count;
                      return (
                        <div className="quota-row operational-quota-row" key={item.cookieStoreId}>
                          <div className="quota-name">
                            <span className={`container-dot ${item.color}`} />
                            <b>{item.internalLabel || item.name}</b>
                          </div>
                          {allocationMode === "custom" ? (
                            <div className="quota-stepper">
                              <button aria-label="Kurangi satu" onClick={() => setQuota(item.cookieStoreId, Number(proposed || 0) - 1)}>−</button>
                              <input
                                aria-label={`Jumlah lead ${item.internalLabel || item.name}`}
                                type="number"
                                min="0"
                                value={quotas[item.cookieStoreId] || 0}
                                onChange={(event) => setQuota(item.cookieStoreId, Number(event.target.value))}
                              />
                              <button aria-label="Tambah satu" onClick={() => setQuota(item.cookieStoreId, Number(proposed || 0) + 1)}>+</button>
                              {remainingTotal > 0 && (
                                <button className="add-rest" onClick={() => setQuota(item.cookieStoreId, Number(proposed || 0) + remainingTotal)}>+ sisa</button>
                              )}
                            </div>
                          ) : (
                            <div className="automatic-count"><strong>{proposed}</strong><span>lead</span></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="queue-footer">
                    <div className={`allocation-total allocation-status ${remainingTotal === 0 ? "complete" : remainingTotal < 0 ? "over" : "pending"}`}>
                      <div><span>Lead valid</span><b>{previewSummary.ready}</b></div>
                      <div><span>Dibagikan</span><b>{allocatedTotal}</b></div>
                      <div><span>{remainingTotal < 0 ? "Kelebihan" : "Belum dibagi"}</span><b>{Math.abs(remainingTotal)}</b></div>
                    </div>
                    <button
                      className="primary create-queue"
                      disabled={creatingQueue}
                      onClick={create}
                    >
                      <Play size={17} /> {creatingQueue ? "Membuat antrean…" : "Buat antrean"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
      {editingTemplate && (
        <div className="modal-backdrop" onMouseDown={() => setEditingTemplate(false)}>
          <div className="modal template-modal" onMouseDown={(event) => event.stopPropagation()}>
            <h2>Template pesan</h2>
            <div className="template-modal-layout">
              <div className="setup-editor">
                <label>
                  Nama template
                  <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
                </label>
                <label>
                  Isi pesan
                  <textarea rows={9} value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} />
                </label>
                <div className="template-tools">
                  <button onClick={() => setTemplateBody(`${templateBody}{business_name}`)}>
                    Sisipkan Business Name
                  </button>
                  <button className="primary" onClick={saveTemplate}>Simpan template</button>
                </div>
              </div>
              <div className="preview-card live-template-preview">
                <span>PRATINJAU LANGSUNG</span>
                <small>{previewBusinessName}</small>
                <p>{renderTemplate(templateBody, previewBusinessName) || "Pesan akan tampil di sini."}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  project,
  go,
}: {
  project: Project;
  go: (v: View) => void;
}) {
  const [s, setS] = useState(emptySummary);
  useEffect(() => {
    window.desktop.dashboard.summary(project.id).then(setS);
  }, [project.id]);
  const cards = [
    ["Belum diproses", s.unprocessed, "neutral"],
    ["Chat dibuka", s.opened, "blue"],
    ["Terkirim", s.sent, "green"],
    ["Perlu diperbaiki", s.needs_fix, "orange"],
  ];
  return (
    <>
      <div className="overview">
        <div>
          <span className="eyebrow">PROGRES HARI INI</span>
          <h2>
            {s.total - s.unprocessed} dari {s.total} lead sudah ditindaklanjuti
          </h2>
          <div className="progress">
            <i
              style={{
                width: `${s.total ? ((s.total - s.unprocessed) / s.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <button className="primary" onClick={() => go("queue")}>
          <Play size={17} />
          Mulai antrean
        </button>
      </div>
      <div className="metric-grid">
        {cards.map(([label, n, t]) => (
          <div className={`metric ${t}`}>
            <span>{label}</span>
            <b>{n}</b>
            <small>
              {Math.round((Number(n) / Math.max(s.total, 1)) * 100)}% dari total
            </small>
          </div>
        ))}
      </div>
      <div className="two-col">
        <div className="panel">
          <div className="section-title">
            <div>
              <h2>Kesiapan antrean</h2>
              <p>Pastikan semua lead siap sebelum mulai.</p>
            </div>
          </div>
          <div className="readiness">
            <button onClick={() => go("leads")}>
              <span>Belum punya container</span>
              <b>{s.unassigned}</b>
              <ChevronRight size={17} />
            </button>
            <button onClick={() => go("leads")}>
              <span>Nomor perlu diperbaiki</span>
              <b>{s.needs_fix}</b>
              <ChevronRight size={17} />
            </button>
            <button onClick={() => go("templates")}>
              <span>Periksa template aktif</span>
              <b>→</b>
            </button>
          </div>
        </div>
        <div className="panel safe">
          <MessageSquareText size={24} />
          <h2>Anda tetap memegang kendali</h2>
          <p>
            Aplikasi hanya membuka draft chat. Status “Terkirim” selalu Anda
            tandai sendiri setelah menekan Kirim di WhatsApp.
          </p>
        </div>
      </div>
    </>
  );
}

function Leads({
  project,
  flash,
}: {
  project: Project;
  flash: (m: string) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]),
    [containers, setContainers] = useState<FirefoxContainer[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [filters, setFilters] = useState({
      search: "",
      status: "",
      container: "",
      sort: "number",
    });
  const load = () =>
    Promise.all([
      window.desktop.leads.list(project.id, filters),
      window.desktop.containers.list(project.id),
    ]).then(([l, c]) => {
      setLeads(l);
      setContainers(c.filter((x) => x.selected));
    });
  useEffect(() => {
    load();
  }, [
    project.id,
    filters.search,
    filters.status,
    filters.container,
    filters.sort,
  ]);
  const assign = async (c: string) => {
    await window.desktop.leads.assign(selected, c || null);
    setSelected([]);
    await load();
    flash(`${selected.length} lead diperbarui`);
  };
  return (
    <div className="panel full">
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            placeholder="Cari nama atau nomor…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">Semua status</option>
          {Object.entries(statusLabel).map(([v, l]) => (
            <option value={v}>{l}</option>
          ))}
        </select>
        <select
          value={filters.container}
          onChange={(e) =>
            setFilters({ ...filters, container: e.target.value })
          }
        >
          <option value="">Semua container</option>
          <option value="unassigned">Tanpa alokasi</option>
          {containers.map((c) => (
            <option value={c.cookieStoreId}>{c.internalLabel || c.name}</option>
          ))}
        </select>
        <select
          value={filters.sort}
          onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
        >
          <option value="number">Urut: nomor</option>
          <option value="name">Urut: nama</option>
          <option value="status">Urut: status</option>
        </select>
      </div>
      {selected.length > 0 && (
        <div className="selection-bar">
          <b>{selected.length} lead dipilih</b>
          <span>Tetapkan ke</span>
          <select onChange={(e) => assign(e.target.value)} defaultValue="">
            <option value="" disabled>
              Pilih container
            </option>
            {containers.map((c) => (
              <option value={c.cookieStoreId}>
                {c.internalLabel || c.name}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={() => setSelected([])}>
            Batal
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === leads.length && leads.length > 0}
                  onChange={(e) =>
                    setSelected(e.target.checked ? leads.map((l) => l.id) : [])
                  }
                />
              </th>
              <th>No.</th>
              <th>Nama bisnis</th>
              <th>WhatsApp</th>
              <th>Container tujuan</th>
              <th>Pesan pratinjau</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(l.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, l.id]
                          : selected.filter((x) => x !== l.id),
                      )
                    }
                  />
                </td>
                <td>{l.source_row_number}</td>
                <td>
                  <b>{l.business_name || <em>Nama kosong</em>}</b>
                </td>
                <td className="mono">{l.phone_normalized || l.phone_raw}</td>
                <td>
                  <select
                    className="inline-select"
                    value={l.assigned_container_id || ""}
                    onChange={async (e) => {
                      await window.desktop.leads.assign(
                        [l.id],
                        e.target.value || null,
                      );
                      load();
                    }}
                  >
                    <option value="">Belum dialokasikan</option>
                    {containers.map((c) => (
                      <option value={c.cookieStoreId}>
                        {c.internalLabel || c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="message-cell">{l.message}</td>
                <td>
                  <span className={`status ${l.status}`}>
                    {statusLabel[l.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <div className="empty">
            <Search size={26} />
            <b>Tidak ada lead yang cocok</b>
          </div>
        )}
      </div>
    </div>
  );
}

function Templates({
  project,
  flash,
}: {
  project: Project;
  flash: (m: string) => void;
}) {
  const [items, setItems] = useState<MessageTemplate[]>([]),
    [active, setActive] = useState<MessageTemplate | null>(null),
    [name, setName] = useState(""),
    [body, setBody] = useState("");
  const load = () =>
    window.desktop.templates.list(project.id).then((i) => {
      setItems(i);
      const a = i.find((x) => x.active) || i[0];
      if (a) {
        setActive(a);
        setName(a.name);
        setBody(a.body);
      }
    });
  useEffect(() => {
    load();
  }, [project.id]);
  const save = async () => {
    if (!name.trim() || !body.trim()) return;
    await window.desktop.templates.save(project.id, {
      id: active?.id,
      name,
      body,
    });
    await load();
    flash("Template disimpan");
  };
  const unknown = [...body.matchAll(/\{([^}]+)\}/g)]
    .map((m) => m[1])
    .filter((x) => !["nama_bisnis", "business_name"].includes(x));
  return (
    <div className="template-layout">
      <div className="panel template-list">
        <div className="section-title">
          <h2>Template tersimpan</h2>
          <button
            className="icon-btn"
            onClick={() => {
              setActive(null);
              setName("Template baru");
              setBody("");
            }}
          >
            ＋
          </button>
        </div>
        {items.map((i) => (
          <button
            className={active?.id === i.id ? "active" : ""}
            onClick={() => {
              setActive(i);
              setName(i.name);
              setBody(i.body);
            }}
          >
            <b>{i.name}</b>
            <span>
              {i.active ? "Aktif · " : ""}
              {new Date(i.updated_at).toLocaleDateString("id-ID")}
            </span>
          </button>
        ))}
      </div>
      <div className="panel editor">
        <label>
          Nama template
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Isi pesan
          <textarea
            rows={11}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="placeholder-row">
          <span>Placeholder tersedia</span>
          <button onClick={() => setBody(body + "{business_name}")}>
            {"{business_name}"}
          </button>
        </div>
        {!body.trim() && (
          <div className="warning">
            <AlertTriangle size={17} />
            Template tidak boleh kosong.
          </div>
        )}
        {unknown.length > 0 && (
          <div className="warning">
            <AlertTriangle size={17} />
            Placeholder tidak didukung:{" "}
            {unknown.map((x) => `{${x}}`).join(", ")}
          </div>
        )}
        <div className="preview-card">
          <span>PRATINJAU · TOKO MAJU JAYA</span>
          <p>
            {renderTemplate(body) ||
              "Pesan akan tampil di sini."}
          </p>
        </div>
        <div className="right">
          <button
            className="primary"
            disabled={!body.trim() || unknown.length > 0}
            onClick={save}
          >
            Simpan & jadikan aktif
          </button>
        </div>
      </div>
    </div>
  );
}

function Containers({
  project,
  settings,
  flash,
}: {
  project: Project;
  settings: AppSettings | null;
  flash: (m: string) => void;
}) {
  const [items, setItems] = useState<FirefoxContainer[]>([]),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    window.desktop.containers.list(project.id).then(setItems);
  }, [project.id]);
  const refresh = async () => {
    setLoading(true);
    try {
      const live = await window.desktop.containers.refresh();
      const old = new Map(items.map((i) => [i.cookieStoreId, i]));
      const refreshed = live.map((i) => {
          const savedItem = old.get(i.cookieStoreId);
          return {
            ...i,
            selected: savedItem ? !!savedItem.selected : true,
            internalLabel: savedItem?.internalLabel || "",
          };
        });
      setItems(refreshed);
      await window.desktop.containers.save(project.id, refreshed);
    } catch (e: any) {
      flash(e.message);
    } finally {
      setLoading(false);
    }
  };
  const save = async () => {
    await window.desktop.containers.save(project.id, items);
    flash("Pilihan container disimpan");
  };
  const updateItem = async (
    cookieStoreId: string,
    change: Partial<FirefoxContainer>,
  ) => {
    const current = items.find((item) => item.cookieStoreId === cookieStoreId);
    if (!current) return;
    const updated = { ...current, ...change };
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.cookieStoreId === cookieStoreId ? updated : item,
      ),
    );
    await window.desktop.containers.saveOne(project.id, updated);
  };
  return (
    <>
      <div
        className={`connect-banner ${settings?.addonConnected ? "connected" : ""}`}
      >
        <div>
          {settings?.addonConnected ? (
            <CheckCircle2 size={22} />
          ) : (
            <WifiOff size={22} />
          )}
          <div>
            <b>
              {settings?.addonConnected
                ? "Add-on Firefox terhubung"
                : "Hubungkan add-on Firefox"}
            </b>
            <p>
              {settings?.addonConnected
                ? "Daftar container bisa dimuat dari Firefox."
                : "Pasang add-on dari folder firefox-addon, lalu masukkan token koneksi berikut."}
            </p>
          </div>
        </div>
        {!settings?.addonConnected && <code>{settings?.addonToken}</code>}
      </div>
      <div className="panel full">
        <div className="section-title">
          <div>
            <h2>Container yang dipakai</h2>
            <p>
              Pilih sendiri container tujuan. Pilihan ini tidak memeriksa status
              login WhatsApp.
            </p>
          </div>
          <button
            className="secondary"
            onClick={refresh}
            disabled={loading || !settings?.addonConnected}
          >
            <RefreshCw size={17} />
            {loading ? "Memuat…" : "Muat container Firefox"}
          </button>
        </div>
        <div className="container-list">
          {items.map((i) => (
            <div className="container-row">
              <input
                type="checkbox"
                checked={!!i.selected}
                onChange={(e) =>
                  updateItem(i.cookieStoreId, { selected: e.target.checked })
                }
              />
              <span className={`container-dot ${i.color}`} />
              <div>
                <b>{i.name}</b>
                <small>{i.cookieStoreId}</small>
              </div>
              <input
                placeholder="Label internal, mis. Akun 1"
                value={i.internalLabel || ""}
                onChange={(e) =>
                  updateItem(i.cookieStoreId, { internalLabel: e.target.value })
                }
              />
            </div>
          ))}
          {items.length === 0 && (
            <div className="empty">
              <Boxes size={28} />
              <b>Belum ada container</b>
              <span>Hubungkan add-on, lalu muat daftar container Firefox.</span>
            </div>
          )}
        </div>
        <div className="right">
          <button className="primary" disabled={!items.length} onClick={save}>
            Simpan pilihan container
          </button>
        </div>
      </div>
    </>
  );
}

function Queue({
  project,
  connected,
  flash,
}: {
  project: Project;
  connected: boolean;
  flash: (m: string) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]),
    [idx, setIdx] = useState(0);
  const load = () =>
    window.desktop.leads.list(project.id, { sort: "number" }).then((l) => {
      setLeads(l.filter((x) => x.status !== "sent" && x.status !== "skipped"));
      setIdx((i) => Math.min(i, Math.max(0, l.length - 1)));
    });
  useEffect(() => {
    load();
  }, [project.id]);
  const lead = leads[idx];
  const setStatus = async (s: LeadStatus) => {
    if (!lead) return;
    await window.desktop.leads.status(lead.id, s);
    await load();
    flash(`Status diubah ke ${statusLabel[s]}`);
  };
  const open = async () => {
    if (!lead) return;
    const r = await window.desktop.firefox.openChat(lead.id);
    if (r.ok) {
      await load();
      flash("Chat dibuka di container tujuan");
    } else flash(r.error || "Gagal membuka chat");
  };
  if (!lead)
    return (
      <div className="panel empty big">
        <CheckCircle2 size={38} />
        <h2>Antrean selesai</h2>
        <p>Tidak ada lead aktif yang tersisa.</p>
      </div>
    );
  const canOpen =
    connected &&
    !!lead.phone_normalized &&
    !!lead.assigned_container_id &&
    lead.status !== "needs_fix";
  return (
    <div className="queue-layout">
      <div className="panel queue-main">
        <div className="queue-top">
          <span>
            LEAD {idx + 1} DARI {leads.length}
          </span>
          <div>
            <button
              className="icon-btn"
              disabled={idx === 0}
              onClick={() => setIdx(idx - 1)}
            >
              <ChevronLeft />
            </button>
            <button
              className="icon-btn"
              disabled={idx === leads.length - 1}
              onClick={() => setIdx(idx + 1)}
            >
              <ChevronRight />
            </button>
          </div>
        </div>
        <h2>{lead.business_name || "Nama bisnis belum diisi"}</h2>
        <p className="phone">
          {lead.phone_normalized || lead.phone_raw || "Nomor belum tersedia"}
        </p>
        <div className="container-target">
          <span>CONTAINER TUJUAN</span>
          <b>{lead.container_name || "Belum dialokasikan"}</b>
        </div>
        <div className="final-message">
          <div>
            <span>PESAN FINAL</span>
            <button
              onClick={async () => {
                await window.desktop.firefox.copy(lead.message || "");
                flash("Pesan disalin");
              }}
            >
              <Copy size={16} />
              Salin
            </button>
          </div>
          <p>{lead.message || "Template aktif belum tersedia."}</p>
        </div>
        {!canOpen && (
          <div className="warning">
            <AlertTriangle size={17} />
            {!connected
              ? "Hubungkan add-on Firefox terlebih dahulu."
              : !lead.assigned_container_id
                ? "Pilih container tujuan terlebih dahulu."
                : "Nomor lead perlu diperbaiki."}
          </div>
        )}
        <button className="primary large" disabled={!canOpen} onClick={open}>
          <ExternalLink size={19} />
          Buka chat di container
        </button>
        <p className="manual-note">
          WhatsApp akan terbuka dengan draft siap ditinjau. Anda tetap menekan
          Kirim sendiri.
        </p>
      </div>
      <div className="panel queue-actions">
        <span className={`status ${lead.status}`}>
          {statusLabel[lead.status]}
        </span>
        <h3>Setelah meninjau di WhatsApp</h3>
        <button className="success" onClick={() => setStatus("sent")}>
          <CheckCircle2 size={18} />
          Tandai terkirim
        </button>
        <button className="secondary" onClick={() => setStatus("skipped")}>
          Lewati / jangan hubungi
        </button>
        <button className="ghost" onClick={() => setStatus("unprocessed")}>
          <Undo2 size={17} />
          Kembalikan ke belum diproses
        </button>
        <div className="divider" />
        <button
          className="ghost"
          disabled={idx === leads.length - 1}
          onClick={() => setIdx(Math.min(idx + 1, leads.length - 1))}
        >
          Lead berikutnya
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}

function Audit({
  project,
  flash,
}: {
  project: Project;
  flash: (m: string) => void;
}) {
  const [items, setItems] = useState<AuditItem[]>([]);
  const load = () => window.desktop.audit.list(project.id).then(setItems);
  useEffect(() => {
    load();
  }, [project.id]);
  const undo = async () => {
    await window.desktop.leads.undo(project.id);
    await load();
    flash("Perubahan status terakhir dibatalkan");
  };
  return (
    <div className="panel full">
      <div className="section-title">
        <div>
          <h2>Riwayat perubahan status</h2>
          <p>Catatan lokal dari 100 perubahan terakhir.</p>
        </div>
        <button className="secondary" disabled={!items.length} onClick={undo}>
          <Undo2 size={17} />
          Batalkan perubahan terakhir
        </button>
      </div>
      <div className="timeline">
        {items.map((i) => (
          <div className="timeline-item">
            <i />
            <div>
              <b>{i.business_name || "Lead tanpa nama"}</b>
              <p>
                <span className={`status ${i.old_status}`}>
                  {statusLabel[i.old_status]}
                </span>
                <ChevronRight size={14} />
                <span className={`status ${i.new_status}`}>
                  {statusLabel[i.new_status]}
                </span>
              </p>
              <small>
                {new Date(i.changed_at).toLocaleString("id-ID")} ·{" "}
                {i.source === "open_chat" ? "Buka chat" : "Tindakan pengguna"}
              </small>
            </div>
          </div>
        ))}
        {!items.length && (
          <div className="empty">
            <History size={28} />
            <b>Belum ada perubahan status</b>
          </div>
        )}
      </div>
    </div>
  );
}
