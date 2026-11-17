'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const IN = path.join(DATA_DIR, 'jobs-received.json');
const OUT = path.join(DATA_DIR, 'companies.json');

function capitalToWan(s) {
  const str = String(s || '');
  const m = str.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (/亿/.test(str)) v *= 10000;
  if (/美元|\$|USD/i.test(str)) v *= 7;
  if (!/万/.test(str) && !/亿/.test(str)) v = v / 10000;
  return Math.round(v);
}

function pick(text, label) {
  const re = new RegExp(label + '[：:]([^\\n]+)');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : '';
}

function parseGs(text) {
  return {
    name: pick(text, '企业名称'),
    legalPerson: pick(text, '法定代表人'),
    establishedDate: pick(text, '成立时间') || pick(text, '成立日期'),
    companyType: pick(text, '企业类型'),
    status: pick(text, '经营状态'),
    registeredCapital: pick(text, '注册资本'),
    registeredAddress: pick(text, '注册地址'),
    region: pick(text, '所属地区'),
    creditCode: pick(text, '统一社会信用代码')
  };
}

function main() {
  let jobs = [];
  try { jobs = JSON.parse(fs.readFileSync(IN, 'utf8')); } catch (e) { jobs = []; }
  const map = new Map();
  for (const j of jobs) {
    if (!j.company) continue;
    const key = j.company;
    if (map.has(key)) continue;
    const gs = parseGs(j.companyGongshang || '');
    const capWan = capitalToWan(gs.registeredCapital);
    const isListed = /上市/.test(gs.companyType);
    map.set(key, Object.assign({
      company: j.company,
      companyLink: j.companyLink || '',
      intro: j.companyIntro || '',
      gongshang: j.companyGongshang || ''
    }, gs, { capitalWan: capWan, isListed }));
  }
  const list = Array.from(map.values());
  fs.writeFileSync(OUT, JSON.stringify(list, null, 2), 'utf8');
  console.log('companies:', list.length);
  for (const c of list.slice(0, 8)) {
    console.log('- ' + c.company + ' | ' + c.establishedDate + ' | ' + c.registeredCapital + ' (' + (c.capitalWan == null ? '-' : c.capitalWan) + '万) | ' + (c.isListed ? '上市' : c.companyType));
  }
}

main();