const TIME_ZONE = "Asia/Jakarta";
const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const STATUS_OPTIONS = ["Initial", "Engaged", "No Response"];

function doPost(e) {
  try {
    const request = JSON.parse((e.postData && e.postData.contents) || "{}");
    verifyRequest_(request);
    const payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(request.data))
        .getDataAsString("UTF-8"),
    );
    if (payload.type === "ping") return json_({ ok: true });
    if (payload.type !== "export") throw new Error("Tipe permintaan tidak didukung");
    return json_(exportProject_(payload));
  } catch (error) {
    return json_({
      ok: false,
      error: error && error.message ? error.message : "Permintaan gagal",
    });
  }
}

function setupWorkbook() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID belum diatur di Script Properties.');
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
  const sheet = spreadsheet.getSheetByName('WA Oktober');
  if (!sheet) {
    throw new Error('Sheet WA Oktober tidak ditemukan.');
  }

  prepareSheet_(sheet);
  SpreadsheetApp.flush();
}

function verifyRequest_(request) {
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty("EXPORT_SECRET") || "";
  if (secret.length < 32) throw new Error("EXPORT_SECRET belum dikonfigurasi");
  const timestamp = String(request.timestamp || "");
  const nonce = String(request.nonce || "");
  const data = String(request.data || "");
  const supplied = String(request.signature || "").toLowerCase();
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > 300000)
    throw new Error("Permintaan kedaluwarsa");
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error("Nonce tidak valid");
  if (!data || data.length > 1500000) throw new Error("Payload tidak valid");
  const expected = bytesToHex_(
    Utilities.computeHmacSha256Signature(
      `${timestamp}.${nonce}.${data}`,
      secret,
    ),
  );
  if (!constantTimeEqual_(expected, supplied)) throw new Error("Tanda tangan tidak valid");
  const cache = CacheService.getScriptCache();
  if (cache.get(`nonce:${nonce}`)) throw new Error("Permintaan sudah pernah dipakai");
  cache.put(`nonce:${nonce}`, "1", 600);
}

function exportProject_(payload) {
  if (!/^[a-f0-9-]{16,64}$/i.test(String(payload.projectId || "")))
    throw new Error("ID proyek tidak valid");
  const exportedAt = new Date();
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 5000)
    throw new Error("Jumlah lead tidak valid");
  const cleanRows = payload.rows.map((row) => {
    const businessName = String(row.businessName || "").trim();
    const phone = String(row.phone || "").replace(/\D/g, "");
    const accountName = String(row.accountName || "").trim();
    if (!businessName || !/^\d{8,15}$/.test(phone) || !accountName)
      throw new Error("Terdapat lead yang belum lengkap");
    return { businessName, phone, accountName };
  });

  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty("SPREADSHEET_ID") || "";
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID belum dikonfigurasi");
  const exportKey = `export:${payload.projectId}`;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prior = properties.getProperty(exportKey);
    if (prior) return { ...JSON.parse(prior), ok: true, alreadyExported: true };

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
    const monthIndex = Number(Utilities.formatDate(exportedAt, TIME_ZONE, "M")) - 1;
    const sheetName = `WA ${MONTH_NAMES[monthIndex]}`;
    const sheet = ensureMonthlySheet_(spreadsheet, sheetName);
    prepareSheet_(sheet);

    const lastDataRow = getLastDataRow_(sheet);
    const startRow = Math.max(3, lastDataRow + 1);
    const endRow = startRow + cleanRows.length - 1;
    if (endRow > sheet.getMaxRows())
      sheet.insertRowsAfter(sheet.getMaxRows(), endRow - sheet.getMaxRows());
    const nextNumber = getNextNumber_(sheet, lastDataRow);
    const values = cleanRows.map((row, index) => [
      nextNumber + index,
      exportedAt,
      row.businessName,
      row.phone,
      "",
      "",
      row.accountName,
    ]);
    const target = sheet.getRange(startRow, 1, values.length, 7);
    target.setValues(values);
    target.setFontFamily("Arial").setFontSize(10).setVerticalAlignment("middle");
    target.setBorder(true, true, true, true, true, true, "#808080", SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(startRow, 1, values.length, 1).setHorizontalAlignment("center");
    sheet.getRange(startRow, 2, values.length, 1).setNumberFormat("d mmmm yyyy");
    sheet.getRange(startRow, 4, values.length, 1).setNumberFormat("@");
    sheet.getRange(startRow, 6, values.length, 1).setDataValidation(statusValidation_());
    SpreadsheetApp.flush();

    const result = {
      ok: true,
      alreadyExported: false,
      sheetName,
      rowCount: values.length,
      startRow,
      endRow,
    };
    properties.setProperty(exportKey, JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function ensureMonthlySheet_(spreadsheet, sheetName) {
  const existing = spreadsheet.getSheetByName(sheetName);
  if (existing) return existing;
  const template =
    spreadsheet.getSheetByName("WA Oktober") ||
    spreadsheet.getSheetByName("WA September");
  if (!template) throw new Error("Template sheet bulanan tidak ditemukan");
  const sheet = template.copyTo(spreadsheet).setName(sheetName);
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  if (sheet.getMaxRows() > 2)
    sheet.getRange(3, 1, sheet.getMaxRows() - 2, 7).clearContent();
  return sheet;
}

function prepareSheet_(sheet) {
  if (sheet.getMaxRows() < 1000)
    sheet.insertRowsAfter(sheet.getMaxRows(), 1000 - sheet.getMaxRows());
  const headerRange = sheet.getRange("A1:G2");
  const headerWasMerged = headerRange.getMergedRanges().length > 0;
  const existingFilter = sheet.getFilter();
  if (headerWasMerged && existingFilter) existingFilter.remove();
  headerRange.breakApart();
  sheet.getRange("A2:G2").clearContent().clearFormat();
  sheet
    .getRange("A1:G1")
    .setValues([["No", "Tanggal", "Nama Usaha", "No HP", "Jenis Bidang", "Status Respon", "WA"]])
    .setBackground("#fff200")
    .setFontColor("#111111")
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBorder(true, true, true, true, true, true, "#202020", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.setRowHeight(1, 28);
  sheet.setRowHeight(2, 10);
  [50, 145, 310, 145, 130, 145, 165].forEach((width, index) =>
    sheet.setColumnWidth(index + 1, width),
  );
  sheet.setFrozenRows(1);
  sheet.getRange(3, 6, sheet.getMaxRows() - 2, 1).setDataValidation(statusValidation_());
  sheet.getRange(3, 4, sheet.getMaxRows() - 2, 1).setNumberFormat("@");

  sheet.getRange("I6:J9").clearContent().clearFormat();
  sheet.getRange("I6:J6").setValues([["Keterangan", "Penjelasan"]]).setFontWeight("bold");
  sheet.getRange("I7:J9").setValues([
    ["Initial", "Baru merespons pembuka"],
    ["Engaged", "Sudah merespons pertanyaan lanjutan atau substantif"],
    ["No Response", "Tidak memberikan respons"],
  ]);
  sheet.getRange("I7").setBackground("#92d050").setFontWeight("bold");
  sheet.getRange("I8").setBackground("#00b0f0").setFontWeight("bold");
  sheet.getRange("I9").setBackground("#ff0000").setFontWeight("bold");
  sheet.setColumnWidth(9, 130);
  sheet.setColumnWidth(10, 430);

  const statusRange = sheet.getRange(3, 6, sheet.getMaxRows() - 2, 1);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Initial").setBackground("#92d050").setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Engaged").setBackground("#00b0f0").setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("No Response").setBackground("#ff0000").setRanges([statusRange]).build(),
  ];
  sheet.setConditionalFormatRules(rules);
  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), 7).createFilter();
}

function statusValidation_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText("Pilih Initial, Engaged, atau No Response")
    .build();
}

function getLastDataRow_(sheet) {
  const values = sheet.getRange(3, 1, sheet.getMaxRows() - 2, 1).getDisplayValues();
  for (let index = values.length - 1; index >= 0; index--)
    if (String(values[index][0]).trim()) return index + 3;
  return 2;
}

function getNextNumber_(sheet, lastDataRow) {
  if (lastDataRow < 3) return 1;
  const numbers = sheet
    .getRange(3, 1, lastDataRow - 2, 1)
    .getValues()
    .flat()
    .map(Number)
    .filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function bytesToHex_(bytes) {
  return bytes
    .map((value) => (value < 0 ? value + 256 : value).toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual_(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index++)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
