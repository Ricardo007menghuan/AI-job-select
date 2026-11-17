'use strict';

const fs = require('fs');
const path = require('path');

const BLACKLIST_FILE = path.join(__dirname, '..', 'data', 'blacklist.json');

function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();
}

function keyOfJob(company, title) {
  return `${norm(company)}|${norm(title)}`;
}

function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function save(list) {
  fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true });
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function isBlockedBy(list, job) {
  const company = norm(job && job.company);
  const title = norm(job && job.title);
  return (list || []).some((e) => {
    if (!e) return false;
    const c = norm(e.company);
    if (e.type === 'company') return c === company;
    return c === company && norm(e.title) === title;
  });
}

function isBlocked(job) {
  return isBlockedBy(load(), job);
}

function addJob(company, title) {
  const list = load();
  const key = keyOfJob(company, title);
  if (list.some((e) => e.key === key && e.type === 'job')) {
    return { list, added: false };
  }
  const entry = {
    type: 'job',
    key,
    company: String(company == null ? '' : company).trim(),
    title: String(title == null ? '' : title).trim(),
    addedAt: new Date().toISOString(),
  };
  list.push(entry);
  save(list);
  return { list, added: true, entry };
}

function addCompany(company) {
  const list = load();
  const key = `company:${norm(company)}`;
  if (list.some((e) => e.key === key && e.type === 'company')) {
    return { list, added: false };
  }
  const entry = {
    type: 'company',
    key,
    company: String(company == null ? '' : company).trim(),
    title: '',
    addedAt: new Date().toISOString(),
  };
  list.push(entry);
  save(list);
  return { list, added: true, entry };
}

function remove(key) {
  const list = load();
  const next = list.filter((e) => e.key !== key);
  save(next);
  return next;
}

module.exports = { BLACKLIST_FILE, load, save, isBlocked, isBlockedBy, addJob, addCompany, remove, keyOfJob };