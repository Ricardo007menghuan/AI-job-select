'use strict';

const fs = require('fs');
const path = require('path');

// 员工口碑库：放在 data/employee-reviews.json（私有数据，不进版本库）。
// 格式：[{ aliases: [公司别名...], items: [{ sentiment, source, text }] }]
// sentiment: 正面 / 负面 / 中性 / 两极
const REVIEWS_FILE = path.join(__dirname, '..', 'data', 'employee-reviews.json');

function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function normalizeName(s) {
  return String(s == null ? '' : s)
    .replace(/[\s()（）·\-_]/g, '')
    .toLowerCase();
}

function getEmployeeReviews(companyName) {
  const c = normalizeName(companyName);
  if (!c) return [];
  for (const rec of load()) {
    const aliases = (rec.aliases || []).map(normalizeName);
    if (aliases.some((a) => c === a || (a.length >= 2 && (c.includes(a) || a.includes(c))))) {
      return rec.items || [];
    }
  }
  return [];
}

module.exports = { getEmployeeReviews, load };