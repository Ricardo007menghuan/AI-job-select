'use strict';

const { chromium } = require('playwright');

const SELECTORS = {
  card: '.job-card-wrapper',
  title: '.job-name',
  salary: '.salary',
  company: '.company-name',
  companyTags: '.company-tag-list li, .tag-list li',
  area: '.job-area',
  link: 'a.job-card-left',
  next: '.options-pages a.next, .pagination a.next, .page a.next',
};

function normalizePublished(text) {
  const s = String(text || '').trim();
  if (/刚刚/.test(s) || /小时前/.test(s)) {
    return { publishedAt: new Date().toISOString().slice(0, 10), daysAgo: 0 };
  }
  if (/今天/.test(s)) {
    return { publishedAt: new Date().toISOString().slice(0, 10), daysAgo: 0 };
  }
  if (/昨天/.test(s)) {
    return { publishedAt: new Date(Date.now() - 86400000).toISOString().slice(0, 10), daysAgo: 1 };
  }
  const days = s.match(/(\d+)\s*天前/);
  if (days) {
    const n = Number(days[1]);
    return { publishedAt: new Date(Date.now() - n * 86400000).toISOString().slice(0, 10), daysAgo: n };
  }
  return { publishedAt: s, daysAgo: null };
}

async function parseCard(card) {
  const get = (sel) => card.locator(sel).first().innerText().catch(() => '');
  const title = (await get(SELECTORS.title)).trim();
  const salary = (await get(SELECTORS.salary)).trim();
  const company = (await get(SELECTORS.company)).trim();
  const area = (await get(SELECTORS.area)).trim();
  const companyTags = (await card.locator(SELECTORS.companyTags).allInnerTexts().catch(() => []))
    .map((t) => t.trim())
    .filter(Boolean);
  const href = (await card.locator(SELECTORS.link).first().getAttribute('href').catch(() => '')) || '';
  const pubText = (await card.locator('.job-card-footer').first().innerText().catch(() => '')) || '';
  const pub = normalizePublished(pubText);
  return {
    source: 'boss',
    title,
    salary,
    company,
    companyTags,
    area,
    link: href ? new URL(href, 'https://www.zhipin.com').href : '',
    publishedAt: pub.publishedAt,
    publishedDaysAgo: pub.daysAgo,
  };
}

async function collectPage(page, limit, out) {
  const cards = await page.locator(SELECTORS.card).all();
  for (const card of cards) {
    if (out.length >= limit) return;
    out.push(await parseCard(card));
  }
}

async function goNext(page) {
  const next = page.locator(SELECTORS.next).first();
  if (await next.count() === 0) return false;
  if (await next.isDisabled().catch(() => false)) return false;
  await next.click();
  await page.waitForTimeout(1500 + Math.random() * 1500);
  return true;
}

async function fetchKeyword(browser, keyword, limit, cityCode) {
  const page = await browser.newPage();
  const out = [];
  try {
    const query = encodeURIComponent(keyword);
    await page.goto(
      `https://www.zhipin.com/web/geek/job?query=${query}&city=${cityCode}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForSelector(SELECTORS.card, { timeout: 180000 });
    let pages = 0;
    while (out.length < limit && pages < 10) {
      await collectPage(page, limit, out);
      if (out.length >= limit) break;
      if (!(await goNext(page))) break;
      pages += 1;
    }
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

async function fetchJobs(opts) {
  const { config, limit, userDataDir } = opts;
  const keywords = (config.search_keywords || []).slice(0, 6);
  const perKeyword = Math.max(1, Math.ceil(limit / Math.max(1, keywords.length)));
  const channel = config.browser && config.browser.channel ? config.browser.channel : undefined;
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel,
  });
  const jobs = [];
  try {
    for (const keyword of keywords) {
      const batch = await fetchKeyword(browser, keyword, perKeyword, config.city_code);
      jobs.push(...batch);
      if (jobs.length >= limit) break;
    }
  } finally {
    await browser.close();
  }
  return jobs.slice(0, limit);
}

module.exports = { fetchJobs };