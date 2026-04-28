/**
 * 17_SearchService.gs
 * Lookup Lat/Long จากข้อมูลชื่อ+ที่อยู่ที่สกปรก
 */

function findBestGeoByPersonPlace(personName, placeName) {
  const p = normalizePersonName(personName || '');
  const a = normalizePlaceName(placeName || '');
  if (isLowQualityPersonName(p) || isLowQualityPlaceText(a)) {
    return { status: 'REVIEW_REQUIRED', lat: '', lng: '', confidence: 0, reason: 'LOW_QUALITY_INPUT' };
  }

  const personCandidates = findPersonCandidates(p, extractPhoneNumbers(personName || ''));
  const placeCandidates = findPlaceCandidates(a);
  if (personCandidates.length === 0 || placeCandidates.length === 0) {
    return { status: 'NOT_FOUND', lat: '', lng: '', confidence: 0, reason: 'MASTER_NOT_FOUND' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dstSheet = ss.getSheetByName('M_DESTINATION');
  const geoSheet = ss.getSheetByName('M_GEO_POINT');
  if (!dstSheet || !geoSheet) return { status: 'ERROR', lat: '', lng: '', confidence: 0, reason: 'SHEET_MISSING' };

  const dstData = dstSheet.getDataRange().getValues();
  const geoMap = {};
  const geoData = geoSheet.getDataRange().getValues();
  for (let i = 1; i < geoData.length; i++) {
    geoMap[geoData[i][0]] = { lat: geoData[i][3], lng: geoData[i][4], usage: safeNumber(geoData[i][11]) };
  }

  const pSet = {};
  personCandidates.forEach(c => pSet[c.personId] = true);
  const lSet = {};
  placeCandidates.forEach(c => lSet[c.placeId] = true);

  const matchedDest = [];
  for (let i = 1; i < dstData.length; i++) {
    if (pSet[dstData[i][1]] && lSet[dstData[i][2]]) {
      matchedDest.push({
        destinationId: dstData[i][0],
        geoId: dstData[i][3],
        usage: safeNumber(dstData[i][9])
      });
    }
  }
  if (matchedDest.length === 0) return { status: 'NOT_FOUND', lat: '', lng: '', confidence: 0, reason: 'DESTINATION_NOT_FOUND' };
  return _aggregateGeoByUsage(matchedDest, geoMap);
}

function LMDS_FIND_LATLONG(personName, placeName) {
  const r = findBestGeoByPersonPlace(personName, placeName);
  return `${r.status}|${r.lat}|${r.lng}|${r.confidence}|${r.reason}`;
}

function runLookupEnrichment() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(getSheetNames().LOOKUP_SOURCE);
  if (!sheet) throw new Error('ไม่พบชีต lookup');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const personCols = splitHeaderCandidates(getConfig('LOOKUP_PERSON_COLUMNS') || 'ชื่อปลายทาง');
  const placeCols = splitHeaderCandidates(getConfig('LOOKUP_PLACE_COLUMNS') || 'ที่อยู่ปลายทาง');
  const pIdx = findHeaderIndex(headers, personCols);
  const aIdx = findHeaderIndex(headers, placeCols);

  const outputHeaders = ['MATCH_STATUS', 'MATCH_LAT', 'MATCH_LONG', 'MATCH_GEO_ID', 'MATCH_CONFIDENCE', 'MATCH_REASON', 'MATCH_UPDATED_AT'];
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let startCol = findHeaderIndex(currentHeaders, ['MATCH_STATUS']) + 1;
  if (startCol <= 0) {
    startCol = currentHeaders.length + 1;
    sheet.getRange(1, startCol, 1, outputHeaders.length).setValues([outputHeaders]);
  }

  for (let i = 1; i < data.length; i++) {
    const person = pIdx > -1 ? data[i][pIdx] : '';
    const place = aIdx > -1 ? data[i][aIdx] : '';
    const r = findBestGeoByPersonPlace(person, place);
    const out = [r.status, r.lat, r.lng, r.geoId || '', r.confidence, r.reason, new Date()];
    sheet.getRange(i + 1, startCol, 1, 7).setValues([out]);
  }
}

function findHeaderIndex(headers, candidates) {
  const normalized = headers.map(h => safeString(h).replace(/\s+/g, '').toLowerCase());
  for (let i = 0; i < candidates.length; i++) {
    const c = safeString(candidates[i]).replace(/\s+/g, '').toLowerCase();
    const idx = normalized.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

function splitHeaderCandidates(rawValue) {
  return safeString(rawValue).split(',').map(s => s.trim()).filter(Boolean);
}

function _aggregateGeoByUsage(matchedDest, geoMap) {
  const buckets = {};
  matchedDest.forEach(d => {
    if (!buckets[d.geoId]) buckets[d.geoId] = { geoId: d.geoId, usage: 0, count: 0 };
    buckets[d.geoId].usage += d.usage || 0;
    buckets[d.geoId].count += 1;
  });
  const sorted = Object.keys(buckets).map(k => buckets[k]).sort((a, b) => b.usage - a.usage);
  if (sorted.length === 1) {
    const g = geoMap[sorted[0].geoId] || {};
    return { status: 'FOUND', lat: g.lat || '', lng: g.lng || '', geoId: sorted[0].geoId, confidence: 95, reason: 'UNIQUE_DESTINATION_MATCH' };
  }
  if (sorted[0].usage > (sorted[1].usage * 2)) {
    const g = geoMap[sorted[0].geoId] || {};
    return { status: 'FOUND_WITH_DOMINANT_HISTORY', lat: g.lat || '', lng: g.lng || '', geoId: sorted[0].geoId, confidence: 85, reason: 'DOMINANT_GEO_BY_USAGE' };
  }
  return { status: 'AMBIGUOUS', lat: '', lng: '', geoId: '', confidence: 60, reason: 'MULTIPLE_GEO_CANDIDATES' };
}
