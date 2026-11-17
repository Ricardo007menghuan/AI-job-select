'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config/config.json');
const { addScore } = require('./resume-match');
const { estimateMinutes, priorityFor } = require('./commute');
const { resolve: resolveArea, districtOf } = require('./geo-areas');
const { capitalToWan, yearsSince } = require('./company-filter');
const { getEmployeeReviews } = require('./employee-reviews');
const { isBlockedBy, load: loadBlacklist } = require('./blacklist');

function decodeBossSalary(s) {
  const map = {
    '\uE031': '0', '\uE032': '1', '\uE033': '2', '\uE034': '3', '\uE035': '4',
    '\uE036': '5', '\uE037': '6', '\uE038': '7', '\uE039': '8', '\uE03A': '9'
  };
  return String(s == null ? '' : s).replace(/[\uE031-\uE03A]/g, (c) => map[c] || c);
}

const RADICAL_MAP = {
  '\u2F00': '\u4E00', '\u2F08': '\u4EBA', '\u2F0A': '\u5165', '\u2F12': '\u529B',
  '\u2F1A': '\u5382', '\u2F1D': '\u53E3', '\u2F1F': '\u571F', '\u2F24': '\u5927',
  '\u2F25': '\u5973', '\u2F26': '\u5B50', '\u2F29': '\u5C71', '\u2F2F': '\u5DE5',
  '\u2F34': '\u5E7F', '\u2F3C': '\u5FC3', '\u2F3E': '\u6237', '\u2F3F': '\u624B',
  '\u2F40': '\u652F', '\u2F42': '\u6587', '\u2F45': '\u65B9', '\u2F49': '\u6708',
  '\u2F4A': '\u6728', '\u2F55': '\u706B', '\u2F5F': '\u7389', '\u2F63': '\u751F',
  '\u2F64': '\u7528', '\u2F65': '\u7530', '\u2F6F': '\u77F3', '\u2F72': '\u79BE',
  '\u2F73': '\u7A74', '\u2F74': '\u7ACB', '\u2F79': '\u7F51', '\u2F83': '\u81EA',
  '\u2F8F': '\u884C', '\u2FA6': '\u91D1', '\u2FAF': '\u9762', '\u2FBC': '\u9AD8'
};

function normalizeText(s) {
  if (s == null) return '';
  let out = String(s).normalize('NFKC');
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, '');
  out = out.replace(/[\u2F00-\u2FDB]/g, (c) => RADICAL_MAP[c] || c);
  return out;
}

function dedupe(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    const key = `${j.company}|${j.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(j);
    }
  }
  return out;
}

function companyQuality(tags) {
  const t = (tags || []).map((x) => String(x)).join(' ');
  let q = 0;
  if (/已上市|上市公司|A股|港股|美股/.test(t)) q += 40;
  if (/D轮|E轮|F轮|G轮/.test(t)) q += 25;
  if (/C轮/.test(t)) q += 20;
  if (/B轮/.test(t)) q += 12;
  if (/10000人以上|万人以上/.test(t)) q += 25;
  if (/1000-9999人/.test(t)) q += 15;
  if (/500-999人/.test(t)) q += 8;
  return q;
}

function gsPick(text, label) {
  const re = new RegExp(label + '[：:]([^\\n]+)');
  const m = String(text || '').match(re);
  return m ? m[1].trim() : '';
}

function companyQualityFromGs(text) {
  if (!text) return 0;
  let q = 0;
  const type = gsPick(text, '企业类型');
  if (/上市/.test(type)) q += 40;
  const cap = capitalToWan(gsPick(text, '注册资本'));
  if (cap >= 100000) q += 30;
  else if (cap >= 10000) q += 20;
  else if (cap >= 1000) q += 10;
  const est = gsPick(text, '成立时间') || gsPick(text, '成立日期');
  const years = yearsSince(est);
  if (years != null && years >= 10) q += 15;
  else if (years != null && years >= 3) q += 8;
  return q;
}

function locate(job) {
  if (job.lng != null && job.lat != null) return job;
  const c = resolveArea(job.area || job.address || '');
  if (c) {
    job.lng = c.lng;
    job.lat = c.lat;
  }
  return job;
}

function enrich(jobs) {
  return jobs.map((j) => {
    const j2 = { ...locate(j) };
    if (j2.salary) {
      const decoded = decodeBossSalary(String(j2.salary));
      if (decoded !== String(j2.salary)) {
        j2.salary = decoded;
        j2.salaryEncoded = false;
      }
    }
    if (j2.title) j2.title = normalizeText(j2.title);
    if (j2.company) j2.company = normalizeText(j2.company);
    if (j2.description) j2.description = normalizeText(j2.description);
    if (Array.isArray(j2.tags)) j2.tags = j2.tags.map(normalizeText);
    if (Array.isArray(j2.companyTags)) j2.companyTags = j2.companyTags.map(normalizeText);
    j2.district = districtOf(j2.area || j2.address || '');
    j2.companyQuality = companyQuality(j2.companyTags) + companyQualityFromGs(j2.companyGongshang || '');
    const audit = loadAuditMap().get(normalizeText(j2.company));
    if (audit) {
      j2.companyAudit = audit;
      j2.companyScore = audit.score != null ? Math.round(j2.companyQuality * 0.5 + audit.score * 0.5) : j2.companyQuality;
    } else {
      j2.companyScore = j2.companyQuality;
    }
    j2.companyMeta = {
      establishedDate: gsPick(j2.companyGongshang || '', '成立时间') || gsPick(j2.companyGongshang || '', '成立日期'),
      registeredCapital: gsPick(j2.companyGongshang || '', '注册资本'),
      capitalWan: capitalToWan(gsPick(j2.companyGongshang || '', '注册资本')),
      companyType: gsPick(j2.companyGongshang || '', '企业类型')
    };
    const generatedReviews = (j2.companyAudit && Array.isArray(j2.companyAudit.employeeReviews) && j2.companyAudit.employeeReviews) || [];
    const employeeReviews = generatedReviews.length ? generatedReviews : getEmployeeReviews(j2.company);
    if (employeeReviews.length) j2.employeeReviews = employeeReviews;
    if (j2.lng != null && j2.lat != null) {
      const est = estimateMinutes(j2.lng, j2.lat);
      j2.commuteMinutes = est.minutes;
      j2.commutePriority = priorityFor(est.minutes, {
        near: config.commute.near_minutes,
        prefer: config.commute.prefer_max_minutes,
      });
    } else {
      j2.commuteMinutes = null;
      j2.commutePriority = 'unknown';
    }
    return addScore(j2);
  });
}

function filterByDistrict(jobs) {
  const allow = config.districts;
  return jobs.filter((j) => !j.district || allow.some((d) => j.district.includes(d) || d.includes(j.district)));
}

function parseBaseSalaryK(salary) {
  const s = String(salary == null ? '' : salary);
  if (!s || /面议/.test(s)) return null;
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-~～]\s*(\d+(?:\.\d+)?)\s*([Kk]|千|万)/);
  if (range) {
    const v = parseFloat(range[1]);
    return /万/.test(range[3]) ? v * 10 : v;
  }
  const single = s.match(/(\d+(?:\.\d+)?)\s*([Kk]|千|万)/);
  if (single) {
    const v = parseFloat(single[1]);
    return /万/.test(single[2]) ? v * 10 : v;
  }
  return null;
}

function minBaseSalaryK() {
  return (config.salary && Number(config.salary.min_base_k)) || 5;
}

function baseSalaryOk(job) {
  const base = parseBaseSalaryK(job && job.salary);
  return base == null || base >= minBaseSalaryK();
}

function filterBySalary(jobs) {
  return jobs.filter(baseSalaryOk);
}

function filterByBlacklist(jobs) {
  const list = loadBlacklist();
  return jobs.filter((j) => !isBlockedBy(list, j));
}

function sortJobs(jobs) {
  const pri = { high: 0, normal: 1, unknown: 2, low: 3 };
  return jobs.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (pri[a.commutePriority] !== pri[b.commutePriority]) return pri[a.commutePriority] - pri[b.commutePriority];
    const bq = b.companyScore ?? b.companyQuality;
    const aq = a.companyScore ?? a.companyQuality;
    if (bq !== aq) return bq - aq;
    return (a.commuteMinutes ?? 999) - (b.commuteMinutes ?? 999);
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function companyMetaText(j) {
  const m = j.companyMeta || {};
  const parts = [];
  if (m.establishedDate) parts.push('成立 ' + String(m.establishedDate).slice(0, 4));
  if (m.registeredCapital) parts.push(m.registeredCapital);
  if (m.companyType && /上市/.test(m.companyType)) parts.push('上市');
  return parts.join(' · ');
}

const AUDIT_FILE = path.join(__dirname, '..', 'data', 'company-audit.json');

function loadAuditMap() {
  try {
    const arr = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    return new Map(arr.map((a) => [normalizeText(a.company), a]));
  } catch (e) {
    return new Map();
  }
}

function auditText(j) {
  const a = j.companyAudit;
  if (!a || a.score == null) return '';
  const label = { 高: '高风险', 中: '中风险', 低: '低风险' }[a.riskLevel] || String(a.riskLevel || '');
  return '<br><small>风评: ' + label + ' ' + a.score + '分 · ' + esc(a.verdict) + '</small>';
}

function jobDetailCell(j) {
  const desc = (j.description || '').slice(0, 800);
  const intro = (j.companyIntro || (j.companyInfo && j.companyInfo.intro) || '').slice(0, 500);
  const gs = (j.companyGongshang || '').slice(0, 500);
  const a = j.companyAudit;
  let audit = '';
  const employeeReviews = j.employeeReviews || [];
  let employeeReviewsHtml = '';
  if (employeeReviews.length) {
    employeeReviewsHtml = '<p><b>员工口碑</b>' + employeeReviews.map((r) => '<br>[' + esc(r.sentiment) + '] ' + esc(r.text) + ' <small>(' + esc(r.source) + ')</small>').join('') + '</p>';
  } else {
    employeeReviewsHtml = '<p><b>员工口碑</b><br>暂无公开员工口碑，后续逐步补充。</p>';
  }
  if (a) {
    const risk = { 高: '高风险', 中: '中风险', 低: '低风险' }[a.riskLevel] || String(a.riskLevel || '');
    const pros = (a.pros || []).map(esc).join('；') || '—';
    const cons = (a.cons || []).map(esc).join('；') || '—';
    const missing = (a.missing || []).map(esc).join('、') || '—';
    audit = '<p><b>风评</b>：' + risk + ' ' + (a.score == null ? '—' : a.score + '分') + ' · ' + esc(a.verdict || '') + '<br><b>优点</b>：' + pros + '<br><b>风险点</b>：' + cons + '<br><b>待核实</b>：' + missing + '</p>';
  }
  return '<details><summary>详情</summary><div class="detail"><p><b>职位描述</b><br>' + esc(desc || '无') + '</p><p><b>公司简介</b><br>' + esc(intro || '无') + '</p><p><b>工商信息</b><br>' + esc(gs || '无') + '</p>' + audit + employeeReviewsHtml + '</div></details>';
}

function buildHtml(jobs) {
  const PORT = config.collect_server.port || 8890;
  const MIN_BASE_K = (config.salary && Number(config.salary.min_base_k)) || 5;
  const API_BASE = `http://127.0.0.1:${PORT}`;
  const rows = jobs.map((j) => {
    const link = j.link ? `<a href="${esc(j.link)}" target="_blank">投递</a>` : '-';
    const priLabel = { high: '高', normal: '中', low: '低', unknown: '未知' }[j.commutePriority] || '未知';
    const tags = (j.companyTags || []).map(esc).join(' / ');
    return `<tr>
      <td>${esc(j.company)}<br><small>${tags}</small><br><small>${esc(companyMetaText(j))}</small>${auditText(j)}</td>
      <td>${esc(j.title)}</td>
      <td>${esc(j.salary)}</td>
      <td>${esc(j.area)}</td>
      <td>${esc(j.publishedAt || '')}</td>
      <td>${j.commuteMinutes == null ? '-' : j.commuteMinutes + ' 分钟'}</td>
      <td>${priLabel}</td>
      <td>${j.matchScore}</td>
      <td title="${esc('结构分' + j.companyQuality + ' + 风评' + (j.companyAudit && j.companyAudit.score != null ? j.companyAudit.score : '—'))}">${j.companyScore ?? j.companyQuality}</td>
      <td>${link}</td>
      <td><button class="blk" data-company="${esc(j.company)}" data-title="${esc(j.title)}">拉黑</button></td>
      <td>${jobDetailCell(j)}</td>
    </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>岗位汇总</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#222;}
table{border-collapse:collapse;width:100%;font-size:14px;}
th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;vertical-align:top;}
th{background:#f5f5f5;}
tr:nth-child(even){background:#fafafa;}
small{color:#888;}
.detail p{margin:4px 0;}
summary{cursor:pointer;color:#1890ff;}
</style>
</head>
<body>
<h2>岗位汇总（共 ${jobs.length} 条，按 匹配度 → 通勤 → 公司质量 排序）</h2>
<p style="color:#666">已自动过滤：底薪 &lt; ${MIN_BASE_K}K、黑名单岗位。 <a href="${API_BASE}/blacklist" target="_blank">黑名单管理</a></p>
<table>
<thead><tr>
<th>公司</th><th>岗位</th><th>薪资</th><th>位置</th><th>发布时间</th><th>通勤</th><th>通勤优先级</th><th>匹配度</th><th>公司质量(综合)</th><th>投递</th><th>拉黑</th><th>详情</th>
</tr></thead>
<tbody>
${rows}
</tbody>
</table>
<script>
const API_BASE = location.port ? location.origin : 'http://127.0.0.1:' + ${PORT};
document.addEventListener('click', function (e) {
  const btn = e.target.closest('button.blk');
  if (!btn) return;
  const company = btn.getAttribute('data-company');
  const title = btn.getAttribute('data-title');
  if (!confirm('拉黑该岗位：' + company + ' · ' + title)) return;
  fetch(API_BASE + '/blacklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: company, title: title })
  }).then(function (r) { return r.json(); })
    .then(function () { location.reload(); })
    .catch(function () { alert('拉黑失败，请确认采集服务器正在运行'); });
});
</script>
</body>
</html>`;
}

function writeReport(jobs, outDir) {
  const enriched = sortJobs(filterByBlacklist(filterBySalary(filterByDistrict(enrich(dedupe(jobs))))));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'jobs-latest.json'), JSON.stringify(enriched, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.html'), buildHtml(enriched), 'utf8');
  return enriched;
}

module.exports = { writeReport, enrich, dedupe, sortJobs, buildHtml, filterByDistrict, filterBySalary, filterByBlacklist, baseSalaryOk, parseBaseSalaryK, companyQuality };