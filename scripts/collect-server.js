'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../config/config.json');
const { partitionNew, markShown } = require('../lib/history');
const { auditMissingCompanies, backfillEmployeeReviews } = require('../lib/company-audit');
const { writeReport, baseSalaryOk } = require('../lib/aggregate');
const { isBlockedBy, load: loadBlacklist, addJob, addCompany, remove: removeBlacklist } = require('../lib/blacklist');

const PORT = config.collect_server.port || 8890;
const TARGET = config.collect_server.target_per_day || 150;
const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY = path.join(DATA_DIR, 'history.json');
const PENDING = path.join(DATA_DIR, 'pending.json');
const TODAY_FILE = path.join(DATA_DIR, 'jobs-today.json');

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadToday() {
  const list = loadJson(TODAY_FILE);
  const today = localDate();
  return list.filter((j) => j && j.shownDate === today);
}

let latestJobs = [];
let auditChain = Promise.resolve();

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return []; }
}
function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function keyOf(j) { return `${String(j.company || '').trim()}|${String(j.title || '').trim()}`; }

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
  });
}

function refreshReport() {
  const list = loadJson(TODAY_FILE);
  latestJobs = list;
  return writeReport(list, DATA_DIR);
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function blacklistPageHtml() {
  const rows = loadBlacklist().map((e) => `<li>${e.type === 'company' ? '公司' : '岗位'}：${escHtml(e.company)}${e.title ? ' · ' + escHtml(e.title) : ''} <button data-key="${escHtml(e.key)}">移除</button></li>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>黑名单管理</title>
<style>body{font-family:"Microsoft YaHei";max-width:640px;margin:40px auto;padding:20px;} li{margin:8px 0;} button{margin-left:8px;}</style></head>
<body>
<h1>黑名单管理</h1>
<p><a href="/">返回首页</a> · <a href="/report">查看报告</a></p>
<form id="f"><input id="company" placeholder="公司名" size="24"><input id="title" placeholder="岗位名（留空=拉黑整家公司）" size="30"><button type="submit">加入黑名单</button></form>
<ul id="list">${rows}</ul>
<script>
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
var API=location.origin;
function render(list){document.getElementById('list').innerHTML=list.map(function(e){return '<li>'+(e.type==='company'?'公司':'岗位')+'：'+esc(e.company)+(e.title?' · '+esc(e.title):'')+' <button data-key="'+esc(e.key)+'">移除</button></li>';}).join('');}
document.getElementById('f').addEventListener('submit',function(ev){ev.preventDefault();var c=document.getElementById('company').value.trim();var t=document.getElementById('title').value.trim();if(!c)return;fetch(API+'/blacklist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:c,title:t})}).then(function(r){return r.json();}).then(function(d){render(d.list);document.getElementById('company').value='';document.getElementById('title').value='';});});
document.getElementById('list').addEventListener('click',function(ev){var b=ev.target.closest('button[data-key]');if(!b)return;fetch(API+'/blacklist/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:b.getAttribute('data-key')})}).then(function(r){return r.json();}).then(function(d){render(d.list);});});
</script>
</body></html>`;
}

function pageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Boss直聘岗位采集</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;max-width:640px;margin:50px auto;padding:20px;background:#f5f5f5;}
h1{color:#1890ff;} .step{background:#fff;padding:15px;margin:10px 0;border-radius:8px;border-left:4px solid #1890ff;}
a.bookmarklet{display:inline-block;padding:12px 24px;background:#1890ff;color:#fff;text-decoration:none;border-radius:6px;font-size:16px;margin:10px 0;}
.note{color:#666;font-size:13px;margin-top:20px;}
</style></head>
<body>
<h1>Boss直聘岗位采集（只采集，不投递）</h1>
<p>服务器: <b>运行中</b>，端口 ${PORT}</p>
<div class="step"><strong>1.</strong> 把下面按钮拖到 Edge 书签栏（Ctrl+Shift+B 显示书签栏）<br>
<a class="bookmarklet" href="javascript:(function(){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/collect.js?'+Date.now();document.head.appendChild(s);})()">采集岗位</a>
</div>
<div class="step"><strong>2.</strong> 打开 Boss 直聘搜索页，设置好筛选条件</div>
<div class="step"><strong>3.</strong> 点击书签栏的“采集岗位”，面板会显示采集进度，自动滚屏加载并回传</div>
<div class="step"><strong>4.</strong> 采集完成后打开 <a href="/report">今日报告（在线查看）</a>，或直接双击 <code>data/report.html</code></div>
<p class="note">每天最多展示 ${TARGET} 条且与历史不重复。底薪 &lt; ${(config.salary && config.salary.min_base_k) || 5}K 与黑名单岗位自动过滤。保持本终端窗口开启。<br><a href="/blacklist">黑名单管理</a></p>
</body></html>`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url.startsWith('/collect.js')) {
    let script = fs.readFileSync(path.join(__dirname, '..', 'lib', 'inject', 'collect-bookmarklet.js'), 'utf8');
    script = script.split('__PORT__').join(String(PORT));
    script = script.split('__MAX_CARDS__').join(String(config.collect_server.max_cards_per_run || 180));
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(script);
    return;
  }

  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(pageHtml());
    return;
  }

  if (req.url === '/report') {
    try {
      const html = fs.readFileSync(path.join(DATA_DIR, 'report.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    } catch (e) {
      res.writeHead(404);
      res.end('报告尚未生成，请先采集一轮');
    }
    return;
  }

  if (req.url === '/collect' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const jobs = JSON.parse(body || '[]');
        const { fresh, history } = partitionNew(jobs, HISTORY);
        const pending = loadJson(PENDING);
        const todayJobs = loadToday();
        const todayDate = localDate();
        const combined = todayJobs.concat(pending, fresh);
        const uniq = [];
        const seen = new Set();
        for (const j of combined) {
          const k = keyOf(j);
          if (!seen.has(k)) { seen.add(k); uniq.push(j); }
        }
        const blacklist = loadBlacklist();
        const eligible = uniq.filter((j) => baseSalaryOk(j) && !isBlockedBy(blacklist, j));
        const today = eligible.slice(0, TARGET);
        const remaining = eligible.slice(TARGET);
        for (const j of today) j.shownDate = todayDate;
        const freshKeys = new Set(fresh.map(keyOf));
        const newlyShown = today.filter((j) => freshKeys.has(keyOf(j)));
        saveJson(PENDING, remaining);
        saveJson(TODAY_FILE, today);
        markShown(history, newlyShown, HISTORY);
        const report = writeReport(today, DATA_DIR);
        latestJobs = today;
        auditChain = auditChain
          .then(() => auditMissingCompanies(latestJobs, DATA_DIR))
          .then(() => backfillEmployeeReviews(latestJobs, DATA_DIR))
          .then(() => {
            writeReport(latestJobs, DATA_DIR);
            console.log('[audit] 风评+员工口碑完成，报告已更新');
          })
          .catch((e) => console.error('[audit] 失败:', e && e.message));
        saveJson(path.join(DATA_DIR, 'jobs-received.json'), jobs);
        saveJson(path.join(DATA_DIR, 'jobs-collected.json'), fresh);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ received: jobs.length, fresh: fresh.length, shown: report.length, pending: remaining.length }));
      } catch (err) {
        res.writeHead(500);
        res.end(String((err && err.message) || err));
      }
    });
    return;
  }

  if (req.url === '/debug' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, 'debug.json'), body, 'utf8');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(String((err && err.message) || err));
      }
    });
    return;
  }

  if (req.url === '/details' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const details = JSON.parse(body || '[]');
        const file = path.join(DATA_DIR, 'jobs-detailed.json');
        const existing = loadJson(file);
        const map = new Map(existing.map((d) => [d.encryptJobId || d.securityId, d]));
        for (const d of details) {
          const k = d.encryptJobId || d.securityId;
          if (k) map.set(k, d);
        }
        const merged = Array.from(map.values());
        saveJson(file, merged);
        saveJson(path.join(DATA_DIR, 'details-received.json'), details);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ received: details.length, merged: merged.length }));
      } catch (err) {
        res.writeHead(500);
        res.end(String((err && err.message) || err));
      }
    });
    return;
  }

  if (req.url === '/blacklist' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(blacklistPageHtml());
    return;
  }

  if (req.url === '/blacklist/list' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(loadBlacklist()));
    return;
  }

  if (req.url === '/blacklist' && req.method === 'POST') {
    readBody(req).then((body) => {
      try {
        const data = JSON.parse(body || '{}');
        let result;
        if (data.company && data.title) result = addJob(data.company, data.title);
        else if (data.company) result = addCompany(data.company);
        else throw new Error('缺少 company');
        refreshReport();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, added: result.added, list: loadBlacklist() }));
      } catch (err) {
        res.writeHead(500);
        res.end(String((err && err.message) || err));
      }
    });
    return;
  }

  if (req.url === '/blacklist/remove' && req.method === 'POST') {
    readBody(req).then((body) => {
      try {
        const data = JSON.parse(body || '{}');
        removeBlacklist(data.key);
        refreshReport();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, list: loadBlacklist() }));
      } catch (err) {
        res.writeHead(500);
        res.end(String((err && err.message) || err));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('404');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('采集服务器运行中: http://127.0.0.1:' + PORT);
  console.log('每天展示 ' + TARGET + ' 条，与历史不重复。Ctrl+C 停止。');
});