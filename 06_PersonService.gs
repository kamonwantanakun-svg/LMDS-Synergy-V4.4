/**
 * 06_PersonService.gs
 * บริหารจัดการข้อมูลบุคคล
 */

/**
 * ค้นหาชื่อคนและให้คะแนนว่าตรงกับ Master ตัวไหน
 */
function resolvePerson(sourceObj) {
  const rawName = sourceObj.destinationNameRaw;
  if (!rawName) return { id: null, isNew: false, score: 0, phone: '', candidates: [] };
  
  // สกัดเบอร์โทรศัพท์
  const phone = extractPhoneNumbers(rawName) || extractPhoneNumbers(sourceObj.addressRaw);
  
  const normName = normalizePersonName(rawName);
  const candidates = findPersonCandidates(normName, phone);
  
  // ไม่มีเลย แปลว่าใหม่ 100%
  if (candidates.length === 0) {
    return { id: null, isNew: true, score: 0, normalized: normName, raw: rawName, phone: phone, candidates: [] };
  }
  
  // ถ้ามี Candidate ให้หาตัวที่คะแนนสูงสุด
  let bestCandidate = null;
  let bestScore = 0;
  
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const score = scorePersonCandidate(normName, c.normalized);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = c;
    }
  }
  
  // ถ้าเกิน Threshold (เช่น >= 90) ถือว่าชัวร์
  const threshold = getThresholds().autoMatchScore;
  const reviewMin = getThresholds().reviewScoreMin;
  
  if (bestScore >= threshold) {
    return { id: bestCandidate.personId, isNew: false, score: bestScore, normalized: normName, raw: rawName, phone: phone, candidates: candidates };
  } else if (bestScore >= reviewMin) {
    // ถ้าก้ำกึ่ง (เช่น 75-89) ให้ส่งเข้า Review
    return { id: null, isNew: false, score: bestScore, normalized: normName, raw: rawName, phone: phone, candidates: candidates };
  } else {
    // ถ้าคะแนนต่ำเกินไป (เช่น < 75) ถือว่าเป็นคนใหม่เลย ไม่ต้อง Review
    return { id: null, isNew: true, score: bestScore, normalized: normName, raw: rawName, phone: phone, candidates: candidates };
  }
}

/**
 * ค้นหา Candidate จาก M_PERSON และ M_PERSON_ALIAS
 */
function findPersonCandidates(normName, phone) {
  if (!normName && !phone) return [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aliases = [];
  
  const mSheet = ss.getSheetByName('M_PERSON');
  const mData = mSheet.getDataRange().getValues();

  // 1. ลองค้นหาด้วยเบอร์โทรศัพท์ก่อน (Confidence สูงสุด)
  if (phone) {
    const searchPhones = phone.split(', ');
    for (let i = 1; i < mData.length; i++) {
      let storedPhone = mData[i][3]; // Column D
      if (storedPhone) {
        storedPhone = String(storedPhone); // ป้องกัน Error ถ้าข้อมูลไม่ใช่ String (เช่น เป็นวันที่)
        for (let p of searchPhones) {
          if (storedPhone.indexOf(p) > -1) {
            aliases.push({
              personId: mData[i][0],
              normalized: mData[i][2],
              type: 'PHONE_MATCH'
            });
          }
        }
      }
    }
    if (aliases.length > 0) return aliases; // ถ้าเจอด้วยเบอร์แล้ว ถือว่าจบเลย
  }

  // 2. หาแบบ Exact Match ใน Alias
  const aliasSheet = ss.getSheetByName('M_PERSON_ALIAS');
  const aliasData = aliasSheet.getDataRange().getValues();
  
  for (let i = 1; i < aliasData.length; i++) {
    if (aliasData[i][3] === normName || aliasData[i][3].indexOf(normName) > -1 || normName.indexOf(aliasData[i][3]) > -1) {
      aliases.push({
        personId: aliasData[i][1],
        normalized: aliasData[i][3],
        type: 'ALIAS'
      });
    }
  }
  
  // 3. ถ้าไม่เจอใน Alias ลองหาใน Master ตรงๆ
  if (aliases.length === 0) {
    for (let i = 1; i < mData.length; i++) {
      if (mData[i][2] === normName) {
        aliases.push({
          personId: mData[i][0],
          normalized: mData[i][2],
          type: 'MASTER'
        });
      }
    }
  }
  
  return aliases;
}

/**
 * ให้คะแนนความเหมือนของ String สองตัว
 */
function scorePersonCandidate(inputNorm, candidateNorm) {
  if (inputNorm === candidateNorm) return 100;
  
  const dice = diceCoefficient(inputNorm, candidateNorm);
  const lev = levenshteinSimilarity(inputNorm, candidateNorm);
  const ratio = lengthRatio(inputNorm, candidateNorm);
  
  // V4.5: Dice 50% + Levenshtein 30% + LengthRatio 20%
  const finalScore = Math.round(((dice * 0.5) + (lev * 0.3) + (ratio * 0.2)) * 100);
  
  // ถ้าสั้นเกินไปหรือต่างกันเกินไป ให้ 0 เพื่อเข้า Review
  return finalScore > 60 ? finalScore : 0;
}

function createPerson(canonicalName, normName, phone) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_PERSON');
  const personId = 'PER-' + uuid().split('-')[0].toUpperCase(); 
  
  sheet.appendRow([
    personId,
    canonicalName,
    normName,
    phone ? "'" + phone : '', // ใส่ ' นำหน้าเพื่อป้องกันเลข 0 หายใน Sheets
    new Date(),
    new Date(),
    1,
    'ACTIVE',
    ''
  ]);
  
  // สร้าง Alias อัตโนมัติให้ตัวเอง
  createPersonAlias(personId, canonicalName, normName);
  
  return personId;
}

function createPersonAlias(personId, aliasRaw, aliasNormalized) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_PERSON_ALIAS');
  
  sheet.appendRow([
    'P_AL-' + uuid().split('-')[0].toUpperCase(),
    personId,
    aliasRaw,
    aliasNormalized,
    'SYSTEM',
    new Date(),
    new Date(),
    1,
    'Y'
  ]);
}

function updatePersonStats(personId) {
  if (!personId) return false;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_PERSON');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === personId) {
      const usage = parseInt(data[i][6], 10) || 0;
      sheet.getRange(i + 1, 6).setValue(new Date()); // last_seen_date
      sheet.getRange(i + 1, 7).setValue(usage + 1);   // usage_count
      return true;
    }
  }
  return false;
}

function getPersonById(personId) {
  if (!personId) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_PERSON');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === personId) {
      return {
        personId: data[i][0],
        canonicalName: data[i][1],
        normalizedName: data[i][2],
        phone: data[i][3],
        firstSeen: data[i][4],
        lastSeen: data[i][5],
        usageCount: data[i][6],
        status: data[i][7],
        note: data[i][8]
      };
    }
  }
  return null;
}

function findPersonById(personId) {
  return getPersonById(personId);
}

function mergePersonRecords(sourceId, targetId, email) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const aliasSheet = ss.getSheetByName('M_PERSON_ALIAS');
  const aliasData = aliasSheet.getDataRange().getValues();
  for (let i = 1; i < aliasData.length; i++) {
    if (aliasData[i][1] === sourceId) {
      aliasSheet.getRange(i + 1, 2).setValue(targetId);
      aliasSheet.getRange(i + 1, 7).setValue(new Date());
    }
  }

  const factSheet = ss.getSheetByName('FACT_DELIVERY');
  const factData = factSheet.getDataRange().getValues();
  for (let i = 1; i < factData.length; i++) {
    if (factData[i][15] === sourceId) factSheet.getRange(i + 1, 16).setValue(targetId);
  }

  const dstSheet = ss.getSheetByName('M_DESTINATION');
  const dstData = dstSheet.getDataRange().getValues();
  for (let i = 1; i < dstData.length; i++) {
    if (dstData[i][1] === sourceId) {
      dstSheet.getRange(i + 1, 2).setValue(targetId);
      dstSheet.getRange(i + 1, 6).setValue(buildDestinationKey(targetId, dstData[i][2], dstData[i][3]));
    }
  }

  const pSheet = ss.getSheetByName('M_PERSON');
  const pData = pSheet.getDataRange().getValues();
  for (let i = 1; i < pData.length; i++) {
    if (pData[i][0] === sourceId) {
      pSheet.getRange(i + 1, 8).setValue('Merged');
      pSheet.getRange(i + 1, 9).setValue(`Merged -> ${targetId} by ${email || 'SYSTEM'} at ${new Date().toISOString()}`);
      break;
    }
  }
  return true;
}
