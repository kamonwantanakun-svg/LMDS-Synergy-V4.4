/**
 * 02_Schema.gs
 * จัดการและตรวจสอบโครงสร้างคอลัมน์และชีต
 */

let SOURCE_COL_MAP_CACHE = null;

/**
 * ตรวจสอบว่าชีตต้นทางมีคอลัมน์ครบ 37 คอลัมน์หรือไม่
 */
function validateSourceSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getSheetNames().SOURCE;
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    throw new Error(`ไม่พบชีตต้นทาง: ${sheetName}`);
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.length < 35) { // คร่าวๆ ควรมีเยอะกว่า 35
    throw new Error(`จำนวนคอลัมน์ในชีต ${sheetName} น้อยกว่าที่คาดหวัง`);
  }
  
  assertRequiredColumns(headers, [
    'ID_SCGนครหลวงJWDภูมิภาค', 'ชื่อปลายทาง', 'ที่อยู่ปลายทาง', 
    'จุดส่งสินค้าปลายทาง', 'LAT', 'LONG', 'SYNC_STATUS', 'Invoice No', 'Shipment No'
  ]);
}

/**
 * ตรวจสอบว่าชีตระบบมีอยู่จริง
 */
function ensureSystemSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const names = getSheetNames();
  
  Object.keys(names).forEach(key => {
    if (!ss.getSheetByName(names[key])) {
      throw new Error(`ไม่พบชีตระบบที่จำเป็น: ${names[key]} กรุณากด ติดตั้งระบบครั้งแรก`);
    }
  });

  // V4.5: validate โครงสร้างที่สำคัญเพิ่มเติม
  validateLookupSchema();
  validateMasterSchemas();
}

/**
 * คืนค่า Mapping ตำแหน่งของคอลัมน์ต้นทาง
 */
function getSourceColumnMap() {
  if (SOURCE_COL_MAP_CACHE) return SOURCE_COL_MAP_CACHE;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(getSheetNames().SOURCE);
  if (!sheet) throw new Error("ไม่พบชีตต้นทาง");
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  
  for (let i = 0; i < headers.length; i++) {
    const headerName = headers[i];
    if (headerName !== null && headerName !== undefined && headerName !== '') {
      map[headerName.toString().trim()] = i;
    }
  }
  
  // เช็คคอลัมน์ SYNC_STATUS ถ้าไม่มีให้สร้าง
  if (map['SYNC_STATUS'] === undefined) {
    const nextCol = headers.length + 1;
    sheet.getRange(1, nextCol).setValue('SYNC_STATUS');
    map['SYNC_STATUS'] = nextCol - 1;
  }
  
  SOURCE_COL_MAP_CACHE = map;
  return map;
}

/**
 * ฟังก์ชันช่วยตรวจสอบ Required Columns
 */
function assertRequiredColumns(headers, requiredCols) {
  const missing = [];
  requiredCols.forEach(col => {
    if (headers.indexOf(col) === -1) missing.push(col);
  });
  
  if (missing.length > 0) {
    throw new Error(`ขาดคอลัมน์ที่จำเป็นในชีตต้นทาง: ${missing.join(', ')}`);
  }
}

/**
 * ตรวจ schema ของชีต lookup (ตารางงานประจำวัน)
 */
function validateLookupSchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getSheetNames().LOOKUP_SOURCE;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`ไม่พบชีต lookup: ${sheetName}`);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const personCols = safeString(getConfig('LOOKUP_PERSON_COLUMNS') || 'ชื่อปลายทาง').split(',').map(s => s.trim()).filter(Boolean);
  const placeCols = safeString(getConfig('LOOKUP_PLACE_COLUMNS') || 'ที่อยู่ปลายทาง').split(',').map(s => s.trim()).filter(Boolean);

  const hasAny = (candidates) => candidates.some(c => headers.indexOf(c) !== -1);
  if (!hasAny(personCols)) {
    throw new Error(`ชีต ${sheetName} ขาดคอลัมน์ person อย่างน้อย 1 คอลัมน์จาก: ${personCols.join(', ')}`);
  }
  if (!hasAny(placeCols)) {
    throw new Error(`ชีต ${sheetName} ขาดคอลัมน์ place อย่างน้อย 1 คอลัมน์จาก: ${placeCols.join(', ')}`);
  }
}

/**
 * ตรวจ schema ของ master หลักที่ใช้ใน match engine
 */
function validateMasterSchemas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requiredMap = {
    'M_PERSON': ['person_id', 'person_name_canonical', 'person_name_normalized', 'phone', 'usage_count'],
    'M_PLACE': ['place_id', 'place_name_canonical', 'place_name_normalized', 'address_best', 'usage_count'],
    'M_GEO_POINT': ['geo_id', 'lat_norm', 'long_norm', 'usage_count'],
    'M_DESTINATION': ['destination_id', 'person_id', 'place_id', 'geo_id', 'destination_key', 'usage_count']
  };

  Object.keys(requiredMap).forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`ไม่พบชีต master: ${sheetName}`);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => safeString(h).trim());
    const missing = requiredMap[sheetName].filter(col => headers.indexOf(col) === -1);
    if (missing.length > 0) {
      throw new Error(`ชีต ${sheetName} ขาดคอลัมน์: ${missing.join(', ')}`);
    }
  });
}

function resetSourceColumnMapCache() {
  SOURCE_COL_MAP_CACHE = null;
}
