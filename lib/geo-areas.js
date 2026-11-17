'use strict';

const fs = require('fs');
const path = require('path');

// 区域坐标表：data/geo-areas.json（私有数据，不进版本库）。
// 格式：{ AREAS: { "区域名": { district, lat, lng } }, DISTRICT_DEFAULT: { "区": { lat, lng } }, ALL_DISTRICTS: ["区1","区2"] }
const FILE = path.join(__dirname, '..', 'data', 'geo-areas.json');

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      AREAS: d && d.AREAS ? d.AREAS : {},
      DISTRICT_DEFAULT: d && d.DISTRICT_DEFAULT ? d.DISTRICT_DEFAULT : {},
      ALL_DISTRICTS: Array.isArray(d && d.ALL_DISTRICTS) ? d.ALL_DISTRICTS : [],
    };
  } catch (e) {
    return { AREAS: {}, DISTRICT_DEFAULT: {}, ALL_DISTRICTS: [] };
  }
}

function resolve(text) {
  const { AREAS, DISTRICT_DEFAULT } = load();
  const s = String(text || '');
  for (const [name, c] of Object.entries(AREAS)) {
    if (s.includes(name)) return { lat: c.lat, lng: c.lng, matched: name, district: c.district };
  }
  for (const d of Object.keys(DISTRICT_DEFAULT)) {
    if (s.includes(d)) return { lat: DISTRICT_DEFAULT[d].lat, lng: DISTRICT_DEFAULT[d].lng, matched: d, district: d };
  }
  return null;
}

function districtOf(text) {
  const { ALL_DISTRICTS } = load();
  const s = String(text || '');
  for (const d of ALL_DISTRICTS) {
    if (s.includes(d)) return d;
  }
  const r = resolve(s);
  return r ? r.district : null;
}

module.exports = { resolve, districtOf, load };