/**
 * 13_ReportService.gs
 * จัดทำรายงานสถิติ เพื่อติดตามคุณภาพข้อมูล (Data Quality Monitor)
 */

function refreshQualityReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rptSheet = ss.getSheetByName('RPT_DATA_QUALITY');
  
  const sourceCount = ss.getSheetByName(getSheetNames().SOURCE).getLastRow() - 1;
  const factCount = ss.getSheetByName('FACT_DELIVERY').getLastRow() - 1;
  const personCount = ss.getSheetByName('M_PERSON').getLastRow() - 1;
  const placeCount = ss.getSheetByName('M_PLACE').getLastRow() - 1;
  const geoCount = ss.getSheetByName('M_GEO_POINT').getLastRow() - 1;
  const destCount = ss.getSheetByName('M_DESTINATION').getLastRow() - 1;
  
  let pendingReviewCount = 0;
  const qSheet = ss.getSheetByName('Q_REVIEW');
  if (qSheet) {
    const qData = qSheet.getRange(2, 18, Math.max(qSheet.getLastRow() - 1, 1), 1).getValues();
    pendingReviewCount = qData.filter(r => r[0] === 'PENDING').length;
  }
  
  rptSheet.appendRow([
    new Date(),
    sourceCount,
    factCount,
    personCount,
    placeCount,
    geoCount,
    destCount,
    factCount, // auto_match (ใช้ยอดทั้งหมดไปก่อน)
    pendingReviewCount,
    0, // duplicate_alert_count
    0, // error_count
    new Date()
  ]);
  
  // ล้างแถวเก่าๆ ถ้ารายงานมีเกิน 100 วัน
  if (rptSheet.getLastRow() > 101) {
    rptSheet.deleteRows(2, rptSheet.getLastRow() - 100);
  }
}

function buildDailySummary() {
  // ฟังก์ชันเผื่อใช้ส่ง LINE Notify หรือ Email สรุปรายวันให้แอดมิน
  refreshQualityReport();
}

function reportNightlyMaintenance() {
  refreshQualityReport();
  const summary = buildPivotSummary();
  sendLineNotify('LMDS Nightly summary: ' + JSON.stringify(summary));
}

function sendLineNotify(message) {
  const token = getConfig('LINE_NOTIFY_TOKEN');
  if (!token) return false;
  try {
    UrlFetchApp.fetch('https://notify-api.line.me/api/notify', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token },
      payload: { message: message }
    });
    return true;
  } catch (e) {
    writeLog('WARN', '13_ReportService', 'sendLineNotify', '', e.message, '');
    return false;
  }
}

function buildPivotSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('FACT_DELIVERY');
  const data = sheet.getDataRange().getValues();
  const byMonth = {};
  for (let i = 1; i < data.length; i++) {
    const d = safeDate(data[i][4]);
    const key = d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM') : 'UNKNOWN';
    byMonth[key] = (byMonth[key] || 0) + 1;
  }
  return byMonth;
}
