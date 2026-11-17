'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../config/config.json');

const BASE_URL = process.env.JOBHUNTER_LLM_BASE || (config.llm && config.llm.base_url) || 'http://127.0.0.1:8000/v1';
const MODEL = process.env.JOBHUNTER_LLM_MODEL || (config.llm && config.llm.model) || 'deepseek-chat';

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function normalizeRisk(r) {
  const s = String(r || '').trim();
  if (/高/.test(s)) return '高';
  if (/中/.test(s)) return '中';
  return '低';
}

function parseJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

async function chat(messages) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content || '');
}

function buildPrompt(company, intro, gongshang, tags) {
  const info = {
    公司名称: company || '未知',
    公司标签: (tags || []).join('、') || '无',
    公司简介: (intro || '缺失').slice(0, 800),
    工商信息: (gongshang || '缺失').slice(0, 800),
  };
  const sys = [
    '你是求职风评助手，帮求职者评估公司质量。',
    '只依据“公司简介/工商信息/标签”里给出的内容判断，禁止编造未提供的具体事实；',
    '无法从材料确认的维度（如经营异常、司法风险、社保人数）要列入 missing，不要猜。',
    'score 是 0-100 的公司质量分：综合注册资本、成立年限、规模、行业、是否上市、简介是否规范等。',
    'employeeReviews 是员工口碑：结合公司公开信息、行业常识与公开求职平台常见评价方向综合给出，仅作参考；不要伪造具体员工原话或精确数字。',
    '只输出一个 JSON 对象，不要输出任何解释文字。',
  ].join('');
  const user = `请评估这家公司，输出 JSON，字段：riskLevel(低/中/高)、score(0-100整数)、pros(最多3条短句)、cons(最多3条短句)、verdict(不超过40字的一句话结论)、employeeReviews(最多4条，每条含 sentiment(正面/负面/中性/两极)、text(不超过50字)、source(简短来源说明))、missing(材料中缺失的关键维度数组)。\n\n材料：\n${JSON.stringify(info, null, 2)}`;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

function sanitizeReviews(list) {
  if (!Array.isArray(list)) return [];
  const allowed = ['正面', '负面', '中性', '两极'];
  return list
    .slice(0, 4)
    .map((r) => ({
      sentiment: allowed.includes(String(r && r.sentiment)) ? String(r.sentiment) : '中性',
      text: String((r && r.text) || '').slice(0, 80),
      source: String((r && r.source) || '公开口碑').slice(0, 40),
    }))
    .filter((r) => r.text);
}

async function auditCompany({ company, intro, gongshang, tags }) {
  const content = await chat(buildPrompt(company, intro, gongshang, tags));
  const parsed = parseJson(content);
  if (!parsed) {
    throw new Error(`无法解析 LLM 输出: ${content.slice(0, 200)}`);
  }
  const score = clampScore(parsed.score);
  if (score == null) {
    throw new Error(`score 非法: ${content.slice(0, 200)}`);
  }
  return {
    company: company || '未知',
    riskLevel: normalizeRisk(parsed.riskLevel),
    score,
    pros: Array.isArray(parsed.pros) ? parsed.pros.map(String).slice(0, 3) : [],
    cons: Array.isArray(parsed.cons) ? parsed.cons.map(String).slice(0, 3) : [],
    verdict: String(parsed.verdict || '').slice(0, 60),
    missing: Array.isArray(parsed.missing) ? parsed.missing.map(String).slice(0, 6) : [],
    employeeReviews: sanitizeReviews(parsed.employeeReviews),
  };
}


function normalizeName(n) {
  return String(n || '').trim();
}

async function auditMissingCompanies(jobs, dataDir, opts) {
  const delayMs = (opts && opts.delayMs) || Number(process.env.JOBHUNTER_AUDIT_DELAY || 800);
  const auditFile = path.join(dataDir, 'company-audit.json');
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
  } catch (e) {
    existing = [];
  }
  const map = new Map(existing.filter((a) => a && a.score != null).map((a) => [normalizeName(a.company), a]));
  const seen = new Set();
  const todo = [];
  for (const j of jobs) {
    const name = normalizeName(j.company);
    if (!name || map.has(name) || seen.has(name)) continue;
    seen.add(name);
    todo.push({
      company: name,
      companyLink: j.companyLink || '',
      intro: j.companyIntro || (j.companyInfo && j.companyInfo.intro) || '',
      gongshang: j.companyGongshang || '',
      tags: j.companyTags || [],
    });
  }
  if (!todo.length) return existing;

  const updated = existing.slice();
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    const idx = updated.findIndex((x) => normalizeName(x.company) === normalizeName(c.company));
    try {
      const a = await auditCompany(c);
      const rec = Object.assign({}, a, { companyLink: c.companyLink, auditedAt: new Date().toISOString() });
      if (idx >= 0) updated[idx] = rec; else updated.push(rec);
      console.log('[audit] ' + c.company + ' -> 风险' + rec.riskLevel + ' ' + rec.score + '分');
    } catch (e) {
      const rec = {
        company: c.company,
        companyLink: c.companyLink,
        riskLevel: '未知',
        score: null,
        pros: [],
        cons: [],
        verdict: '',
        missing: [],
        error: e.message,
        auditedAt: new Date().toISOString(),
      };
      if (idx >= 0) updated[idx] = rec; else updated.push(rec);
      console.log('[audit] ' + c.company + ' -> 失败: ' + e.message);
    }
    if (i < todo.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(auditFile, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

function buildReviewsPrompt(company, intro, gongshang, tags) {
  const info = {
    公司名称: company || '未知',
    公司标签: (tags || []).join('、') || '无',
    公司简介: (intro || '缺失').slice(0, 600),
    工商信息: (gongshang || '缺失').slice(0, 600),
  };
  const sys = [
    '你是求职员工口碑助手，帮求职者整理在职/离职员工对公司的普遍口碑，仅作参考。',
    '可结合公司公开信息、行业常识与公开求职平台（看准网、脉脉、职友集、小红书、知乎、Boss职Q、拉勾等）的常见评价方向综合给出。',
    '不要伪造具体员工原话、精确数字或未经证实的重大丑闻。',
    '只输出一个 JSON 对象，不要输出任何解释文字。',
  ].join('');
  const user = '请给出这家公司的员工口碑。输出 JSON，字段：reviews(最多4条，每条含 sentiment(正面/负面/中性/两极)、text(不超过50字)、source(简短来源说明))。\n\n材料：\n' + JSON.stringify(info, null, 2);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

async function employeeReviewsCompany({ company, intro, gongshang, tags }) {
  const content = await chat(buildReviewsPrompt(company, intro, gongshang, tags));
  const parsed = parseJson(content);
  if (!parsed || !Array.isArray(parsed.reviews)) {
    throw new Error('无法解析员工口碑输出: ' + content.slice(0, 200));
  }
  const reviews = sanitizeReviews(parsed.reviews);
  if (!reviews.length) {
    throw new Error('员工口碑为空: ' + content.slice(0, 200));
  }
  return reviews;
}

async function backfillEmployeeReviews(jobs, dataDir, opts) {
  const delayMs = (opts && opts.delayMs) || Number(process.env.JOBHUNTER_REVIEW_DELAY || 500);
  const concurrency = Math.max(1, (opts && opts.concurrency) || Number(process.env.JOBHUNTER_REVIEW_CONCURRENCY || 5));
  const auditFile = path.join(dataDir, 'company-audit.json');
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
  } catch (e) {
    existing = [];
  }
  const seen = new Set();
  const todo = [];
  for (const j of jobs) {
    const name = normalizeName(j.company);
    if (!name || seen.has(name)) continue;
    const rec = existing.find((x) => normalizeName(x.company) === name);
    if (rec && Array.isArray(rec.employeeReviews) && rec.employeeReviews.length) continue;
    seen.add(name);
    todo.push({
      company: name,
      companyLink: j.companyLink || (rec && rec.companyLink) || '',
      intro: j.companyIntro || (j.companyInfo && j.companyInfo.intro) || '',
      gongshang: j.companyGongshang || '',
      tags: j.companyTags || [],
    });
  }
  if (!todo.length) return existing;

  const updated = existing.slice();
  const sleep = () => new Promise((r) => setTimeout(r, delayMs));
  for (let i = 0; i < todo.length; i += concurrency) {
    const batch = todo.slice(i, i + concurrency);
    await Promise.all(batch.map(async (c) => {
      const idx = updated.findIndex((x) => normalizeName(x.company) === normalizeName(c.company));
      try {
        const reviews = await employeeReviewsCompany(c);
        if (idx >= 0) {
          updated[idx] = Object.assign({}, updated[idx], { employeeReviews: reviews, reviewsAt: new Date().toISOString() });
        } else {
          updated.push({ company: c.company, companyLink: c.companyLink, score: null, employeeReviews: reviews, reviewsAt: new Date().toISOString() });
        }
        console.log('[reviews] ' + c.company + ' -> ' + reviews.length + '条');
      } catch (e) {
        console.log('[reviews] ' + c.company + ' -> 失败: ' + e.message);
        if (idx >= 0) {
          updated[idx] = Object.assign({}, updated[idx], { reviewsError: e.message, reviewsAt: new Date().toISOString() });
        }
      }
    }));
    if (i + concurrency < todo.length) await sleep();
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(auditFile, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

module.exports = { auditCompany, auditMissingCompanies, employeeReviewsCompany, backfillEmployeeReviews, chat, parseJson, BASE_URL, MODEL };

