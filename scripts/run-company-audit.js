'use strict';

const fs = require('fs');
const path = require('path');
const { auditCompany } = require('../lib/company-audit');

const root = path.join(__dirname, '..');
const inputFile = process.argv[2] || path.join(root, 'data', 'jobs-received.json');
const outputFile = process.argv[3] || path.join(root, 'data', 'company-audit.json');
const delayMs = Number(process.env.JOBHUNTER_AUDIT_DELAY || 800);

function uniqueCompanies(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    const name = String(j.company || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      company: name,
      companyLink: j.companyLink || '',
      intro: j.companyIntro || j.companyInfo?.intro || '',
      gongshang: j.companyGongshang || '',
      tags: j.companyTags || [],
    });
  }
  return out;
}

async function main() {
  const jobs = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const companies = uniqueCompanies(jobs);
  console.log(`待风评公司 ${companies.length} 家`);

  const results = [];
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    try {
      const audit = await auditCompany(c);
      results.push({ ...audit, companyLink: c.companyLink, auditedAt: new Date().toISOString() });
      console.log(`[${i + 1}/${companies.length}] ${c.company} -> 风险${audit.riskLevel} ${audit.score}分`);
    } catch (e) {
      console.log(`[${i + 1}/${companies.length}] ${c.company} -> 失败: ${e.message}`);
      results.push({ company: c.company, companyLink: c.companyLink, riskLevel: '未知', score: null, pros: [], cons: [], verdict: '', missing: [], error: e.message, auditedAt: new Date().toISOString() });
    }
    if (i < companies.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), 'utf8');
  const ok = results.filter((r) => r.score != null).length;
  console.log(`完成：${ok}/${results.length} 成功，已写入 ${outputFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
