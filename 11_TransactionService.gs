/**
 * 11_TransactionService.gs
 * บันทึกข้อมูลงานส่งประจำวันลงใน FACT Table (เพื่อให้ Data สะอาดพร้อมใช้งาน)
 */

function buildFactRow(sourceObj, matchResult) {
  return [
    'TX-' + uuid().split('-')[0].toUpperCase(), // tx_id
    getSheetNames().SOURCE,
    sourceObj.rowNumber,
    sourceObj.idScg,
    sourceObj.deliveryDate,
    sourceObj.deliveryTime,
    sourceObj.shipmentNo,
    sourceObj.invoiceNo,
    sourceObj.ownerName,           // raw_owner_name
    sourceObj.destinationNameRaw, // raw_person_name
    sourceObj.addressRaw,          // raw_system_address
    sourceObj.addressFromLatLong, // raw_geo_resolved_address
    sourceObj.latLongText,        // raw_geo_text (จุดส่งสินค้าปลายทาง)
    sourceObj.latRaw,
    sourceObj.longRaw,
    matchResult.person.finalId,
    matchResult.place.finalId,
    matchResult.geo.finalId,
    matchResult.dest.id,
    sourceObj.warehouse,
    sourceObj.distanceKm,
    sourceObj.driverName,
    sourceObj.employeeId,
    sourceObj.employeeEmail,
    sourceObj.licensePlate,
    sourceObj.validationResult,
    sourceObj.anomalyDetected,
    'COMPLETED', // review_status
    'SYNCED',    // sync_status
    new Date(),  // created_at
    new Date()   // updated_at
  ];
}

function upsertFactDelivery(factRowArray) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('FACT_DELIVERY');
  
  // เช็คว่ามีซ้ำหรือไม่ ถ้ามีให้ข้าม (ป้องกันรันสคริปต์ซ้ำ)
  const sourceRecordId = factRowArray[3]; // source_record_id
  if (preventDuplicateTransaction(sourceRecordId)) {
    // ถ้าเจอว่าเคยบันทึกไปแล้ว อัปเดตก็พอ (ในตัวอย่างจะข้าม)
    writeLog('INFO', '11_TransactionService', 'upsertFactDelivery', sourceRecordId, 'Duplicate transaction skipped', '');
    return;
  }
  
  sheet.appendRow(factRowArray);
}

/**
 * เขียน FACT แบบชุดเดียว เพื่อลดเวลาจาก appendRow หลายรอบ
 */
function batchWriteFacts(factRows) {
  if (!factRows || factRows.length === 0) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('FACT_DELIVERY');
  const lastRow = sheet.getLastRow();
  const existingSourceIds = new Set();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
    for (let i = 0; i < existing.length; i++) {
      if (existing[i][0]) existingSourceIds.add(String(existing[i][0]));
    }
  }

  const rowsToWrite = [];
  for (let i = 0; i < factRows.length; i++) {
    const sourceRecordId = String(factRows[i][3] || '');
    if (!sourceRecordId || existingSourceIds.has(sourceRecordId)) continue;
    existingSourceIds.add(sourceRecordId);
    rowsToWrite.push(factRows[i]);
  }

  if (rowsToWrite.length === 0) return 0;
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
  return rowsToWrite.length;
}

function preventDuplicateTransaction(sourceRecordId) {
  if (!sourceRecordId) return false;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('FACT_DELIVERY');
  const data = sheet.getRange(1, 4, sheet.getLastRow(), 1).getValues(); // Column 4 คือ source_record_id
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sourceRecordId) {
      return true;
    }
  }
  return false;
}
