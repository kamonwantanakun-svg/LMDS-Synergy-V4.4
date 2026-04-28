/**
 * 10_MatchEngine.gs
 * สมองกลของระบบ ทำหน้าที่ประสานงานและตัดสินใจว่า Data ชุดนี้คืออะไร
 */

function matchAllEntities(sourceObj) {
  // 1. แยกแก้แต่ละเอนทิตี
  const personResult = resolvePerson(sourceObj);
  const placeResult = resolvePlace(sourceObj);
  const geoResult = resolveGeo(sourceObj);
  
  // 2. ถ้าเอนทิตีไหนมั่นใจว่าใหม่ (isNew = true) ก็ให้สิทธิ์ในการสร้างเลย
  let finalPersonId = personResult.id;
  let finalPlaceId = placeResult.id;
  let finalGeoId = geoResult.id;
  
  let autoCreatedCount = 0;
  
  // สร้าง Person ถ้าเป็นคนใหม่ชัวร์ (ไม่มี Candidate คล้ายเลย)
  if (personResult.isNew) {
    finalPersonId = createPerson(personResult.raw, personResult.normalized, personResult.phone);
    autoCreatedCount++;
  }
  
  // สร้าง Place ถ้าที่อยู่ใหม่ชัวร์
  if (placeResult.isNew) {
    finalPlaceId = createPlace(placeResult.raw, sourceObj.addressRaw, sourceObj.addressFromLatLong);
    autoCreatedCount++;
  }
  
  // สร้าง Geo ถ้าพิกัดห่างไกลจากจุดเดิมทั้งหมด
  if (geoResult.isNew) {
    finalGeoId = createGeoPoint(geoResult.lat, geoResult.lng, geoResult.keys, sourceObj.latLongText);
    autoCreatedCount++;
  }
  
  // 3. รวมคะแนน
  const bonusScore = evaluateThaiGeoBonus(sourceObj);
  const compositeScore = calculateCompositeScore(personResult.score, placeResult.score, geoResult.score, autoCreatedCount, bonusScore);
  
  // 4. สร้างหรือค้นหา Destination
  // (ถ้ายังขาด ID อันใดอันหนึ่ง แสดงว่าคะแนนไม่ถึงเกณฑ์ auto match และมันไม่ใช่ของใหม่ร้อยเปอร์เซ็นต์ -> รอ Review)
  let destResult = { id: null, isNew: false, key: '' };
  if (finalPersonId && finalPlaceId && finalGeoId) {
    destResult = resolveDestination(finalPersonId, finalPlaceId, finalGeoId, sourceObj);
  }
  const ruleHits = evaluateConflictRules(personResult, placeResult, geoResult);
  const rulePenalty = calculateRulePenalty(ruleHits);
  const qualityFlags = sourceObj.qualityFlags || buildDataQualityFlags(sourceObj);
  const ownerBonus = evaluateOwnerContextScore(sourceObj, personResult);
  const finalScore = Math.max(0, compositeScore - rulePenalty + ownerBonus);

  if (finalPersonId) updatePersonStats(finalPersonId);
  if (finalPlaceId) updatePlaceStats(finalPlaceId);
  if (finalGeoId) updateGeoStats(finalGeoId);
  
  return {
    person: { ...personResult, finalId: finalPersonId },
    place: { ...placeResult, finalId: finalPlaceId },
    geo: { ...geoResult, finalId: finalGeoId },
    dest: destResult,
    compositeScore: finalScore,
    ruleHits: ruleHits,
    qualityFlags: qualityFlags
  };
}

function calculateCompositeScore(pScore, plScore, gScore, autoCreatedCount, bonusScore = 0) {
  // ถ้าเพิ่งถูกสร้างใหม่หมด แปลว่าเป็น Master ใหม่ชัวร์ ให้คะแนนเต็ม 100
  if (autoCreatedCount >= 3) return 100;
  
  // น้ำหนัก V4.4: Geo 45%, Person 30%, Place 25%
  let score = (pScore * 0.30) + (plScore * 0.25) + (gScore * 0.45);
  
  // บวกโบนัสความแม่นยำทางภูมิศาสตร์ (ถ้ามี)
  score += bonusScore;
  
  return Math.min(100, Math.round(score));
}

function decideAutoMatchOrReview(matchResult) {
  const thresholds = getThresholds();
  if (matchResult.qualityFlags && matchResult.qualityFlags.length > 0) return 'REVIEW';
  
  // ถ้ามีบาง entity ที่หาไม่เจอและไม่ถูกสิทธิ์สร้างใหม่
  if (!matchResult.person.finalId || !matchResult.place.finalId || !matchResult.geo.finalId) {
    return 'REVIEW';
  }
  
  // ถ้าคะแนนรวมผ่านเกณฑ์ หรือ มีการสร้างใหม่ร้อยเปอร์เซ็นต์ (คะแนนจะได้ 100)
  if (matchResult.compositeScore >= thresholds.autoMatchScore) {
    return 'AUTO_MATCH';
  }
  
  return 'REVIEW';
}

function buildReviewPayload(sourceObj, matchResult) {
  const cPersonIds = matchResult.person.candidates.map(c => c.personId || c.id).join(',');
  const cPlaceIds = matchResult.place.candidates.map(c => c.placeId || c.id).join(',');
  const cGeoIds = matchResult.geo.candidates.map(c => c.geoId || c.id).join(',');
  
  return {
    issueType: detectConflictType(matchResult),
    sourceRecordId: sourceObj.idScg,
    sourceRowNumber: sourceObj.rowNumber,
    invoiceNo: sourceObj.invoiceNo,
    rawPersonName: sourceObj.destinationNameRaw,
    rawPlaceName: sourceObj.addressRaw, // เก็บไว้แสดงผล (อาจจะยุบรวมในอนาคต)
    rawSystemAddress: sourceObj.addressRaw, // ที่อยู่จากระบบ
    rawGeoResolvedAddress: sourceObj.addressFromLatLong, // ที่อยู่จากพิกัด
    rawLat: sourceObj.latRaw,
    rawLong: sourceObj.longRaw,
    candidatePersonIds: cPersonIds,
    candidatePlaceIds: cPlaceIds,
    candidateGeoIds: cGeoIds,
    score: matchResult.compositeScore,
    recommendedAction: 'MANUAL_REVIEW',
    note: (analyzeGeoWarning(sourceObj.addressRaw) || '') +
          '\nflags=' + (matchResult.qualityFlags || []).join('|') +
          '\nrules=' + (matchResult.ruleHits || []).map(h => h.code).join('|') +
          '\n💡 ที่อยู่แนะนำ: ' + smartMergeAddress(sourceObj.addressRaw, sourceObj.addressFromLatLong)
  };
}

function detectConflictType(matchResult) {
  if (matchResult.geo.score >= 90 && matchResult.person.score < 50) return 'SAME_GEO_DIFF_PERSON'; // ปัญหา 8
  if (matchResult.person.score >= 90 && matchResult.geo.score < 50) return 'SAME_PERSON_DIFF_GEO'; // ปัญหา 7
  if (matchResult.person.score >= 90 && matchResult.place.score < 50) return 'SAME_PERSON_DIFF_PLACE'; // ปัญหา 6
  if (matchResult.place.score >= 90 && matchResult.person.score < 50) return 'SAME_PLACE_DIFF_PERSON'; // ปัญหา 5
  return 'AMBIGUOUS_DATA'; // ครุมเครือ
}

/**
 * คำนวณคะแนนโบนัสถ้าข้อมูลภูมิศาสตร์ในที่อยู่ดิบตรงกับพิกัดจริง
 */
function evaluateThaiGeoBonus(sourceObj) {
  let bonus = 0;
  const rawAddr = sourceObj.addressRaw || '';
  const geoAddr = sourceObj.addressFromLatLong || '';
  
  if (!rawAddr || !geoAddr) return 0;
  
  const t1 = extractGeoTokens(rawAddr);
  const t2 = extractGeoTokens(geoAddr);
  if (t1.subdistrict && t1.subdistrict === t2.subdistrict) bonus += 15;
  if (t1.district && t1.district === t2.district) bonus += 10;
  if (t1.province && t1.province === t2.province) bonus += 5;
  if (t1.province && t2.province && t1.province !== t2.province) bonus -= 20;
  
  return bonus;
}

function getConflictRuleTable() {
  return [
    { code: 'R01_DUP_PERSON_NAME', severity: 'MEDIUM', penalty: 10 },
    { code: 'R02_DUP_PLACE_NAME', severity: 'MEDIUM', penalty: 10 },
    { code: 'R03_DUP_GEO_POINT', severity: 'LOW', penalty: 5 },
    { code: 'R04_SAME_PERSON_ALIAS_VARIANT', severity: 'MEDIUM', penalty: 8 },
    { code: 'R05_DIFF_PERSON_SAME_PLACE', severity: 'HIGH', penalty: 15 },
    { code: 'R06_SAME_PERSON_DIFF_PLACE', severity: 'HIGH', penalty: 15 },
    { code: 'R07_SAME_PERSON_DIFF_GEO', severity: 'HIGH', penalty: 20 },
    { code: 'R08_DIFF_PERSON_SAME_GEO', severity: 'HIGH', penalty: 20 }
  ];
}

function evaluateConflictRules(personR, placeR, geoR) {
  const hits = [];
  if ((personR.candidates || []).length > 1) hits.push({ code: 'R01_DUP_PERSON_NAME' });
  if ((placeR.candidates || []).length > 1) hits.push({ code: 'R02_DUP_PLACE_NAME' });
  if ((geoR.candidates || []).length > 1) hits.push({ code: 'R03_DUP_GEO_POINT' });
  if (personR.score >= 90 && placeR.score < 50) hits.push({ code: 'R06_SAME_PERSON_DIFF_PLACE' });
  if (personR.score >= 90 && geoR.score < 50) hits.push({ code: 'R07_SAME_PERSON_DIFF_GEO' });
  if (geoR.score >= 90 && personR.score < 50) hits.push({ code: 'R08_DIFF_PERSON_SAME_GEO' });
  return dedupeRuleHits(hits);
}

function dedupeRuleHits(hits) {
  const map = {};
  (hits || []).forEach(h => map[h.code] = h);
  return Object.keys(map).map(k => map[k]);
}

function calculateRulePenalty(ruleHits) {
  const table = getConflictRuleTable();
  let penalty = 0;
  (ruleHits || []).forEach(hit => {
    const t = table.find(r => r.code === hit.code);
    if (t) penalty += t.penalty;
  });
  return Math.min(30, penalty);
}

function runConflictRuleSelfTest() {
  const tests = [
    { person: { score: 95, candidates: [1] }, place: { score: 40, candidates: [1] }, geo: { score: 95, candidates: [1] }, expect: 'R06_SAME_PERSON_DIFF_PLACE' },
    { person: { score: 30, candidates: [1,2] }, place: { score: 30, candidates: [1] }, geo: { score: 90, candidates: [1] }, expect: 'R01_DUP_PERSON_NAME' }
  ];
  const failed = [];
  tests.forEach((t, idx) => {
    const codes = evaluateConflictRules(t.person, t.place, t.geo).map(x => x.code);
    if (codes.indexOf(t.expect) === -1) failed.push(idx + 1);
  });
  SpreadsheetApp.getUi().alert(failed.length === 0 ? 'Conflict rule self-test: PASS' : 'Conflict rule self-test: FAIL cases ' + failed.join(','));
}

function evaluateOwnerContextScore(sourceObj, personResult) {
  const owner = normalizeCompanyName(sourceObj.ownerName || '');
  const person = normalizePersonName(sourceObj.destinationNameRaw || '');
  if (!owner || !person) return 0;
  if (owner.indexOf(person) > -1 || person.indexOf(owner) > -1) return -5;
  if (personResult.score >= 90) return 3;
  return 0;
}
