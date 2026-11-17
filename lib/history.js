'use strict';

const fs = require('fs');
const path = require('path');

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return [];
  }
}

function keyOf(job) {
  return `${String(job.company || '').trim()}|${String(job.title || '').trim()}`;
}

function save(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

function partitionNew(jobs, file) {
  const history = load(file);
  const seen = new Set(history.map(keyOf));
  const fresh = [];
  for (const j of jobs) {
    const k = keyOf(j);
    if (!seen.has(k)) {
      seen.add(k);
      fresh.push(j);
    }
  }
  return { fresh, history, seen };
}

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function markShown(history, jobs, file) {
  const now = localDate();
  for (const j of jobs) {
    history.push({ company: j.company, title: j.title, firstShown: now });
  }
  save(file, history);
}

module.exports = { load, save, keyOf, partitionNew, markShown };