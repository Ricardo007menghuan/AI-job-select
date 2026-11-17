(function () {
  'use strict';

  var PORT = __PORT__;
  var MAX_CARDS = __MAX_CARDS__;
  var DETAIL_MAX = 20;
  var SERVER = 'http://127.0.0.1:' + PORT + '/collect';
  var DEBUG = 'http://127.0.0.1:' + PORT + '/debug';

  var LS_KEY = 'bossCollectProgressV1';

  var state = window.__bossCollect;
  if (!state) {
    state = { apiJobs: {}, apiCount: 0, hooked: false, detailCursor: 0 };
    window.__bossCollect = state;
  }

  var oldPanel = document.getElementById('boss-collect-panel');
  if (oldPanel) { oldPanel.remove(); }

  var apiJobs = state.apiJobs;
  var cards = [];
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && Array.isArray(saved.cards) && saved.cards.length) {
      cards = saved.cards;
      state.detailCursor = saved.cursor != null ? saved.cursor : saved.cards.length;
    }
  } catch (e) {}
  var running = false;
  var done = false;

  function idOf(item) {
    if (!item) return '';
    return item.securityId || item.encryptJobId || '';
  }

  function looksLikeJob(item) {
    if (!item || typeof item !== 'object') return false;
    return !!(item.securityId || item.encryptJobId || (item.jobName && item.brandName));
  }

  function findJobList(obj, depth) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      if ((depth || 0) > 10) return null;
      if (obj.length && looksLikeJob(obj[0])) return obj;
      for (var i = 0; i < obj.length; i++) {
        var r = findJobList(obj[i], (depth || 0) + 1);
        if (r) return r;
      }
      return null;
    }
    if ((depth || 0) > 10) return null;
    if (Array.isArray(obj.jobList)) return obj.jobList;
    if (Array.isArray(obj.jobCardList)) return obj.jobCardList;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (k === 'jobList' || k === 'jobCardList') continue;
      var v = obj[k];
      if (v && typeof v === 'object') {
        var found = findJobList(v, (depth || 0) + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function recordApi(url, json) {
    try {
      var list = findJobList(json, 0) || [];
      var got = 0;
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var id = idOf(item);
        if (!id) continue;
        if (!state.apiJobs[id]) { state.apiCount += 1; got += 1; }
        state.apiJobs[id] = item;
        if (item.securityId) state.apiJobs[item.securityId] = item;
        if (item.encryptJobId) state.apiJobs[item.encryptJobId] = item;
      }
      if (got && !window.__bossCollectSample) {
        window.__bossCollectSample = list[0];
        console.log('[boss-collect] 捕获列表 API 样本:', list[0]);
      }
    } catch (err) {}
  }

  function installHooks() {
    if (state.hooked) return;
    state.hooked = true;

    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
        var p = origFetch.apply(this, arguments);
        if (/api|job|search|geek/i.test(url)) {
          p.then(function (res) {
            try {
              res.clone().json().then(function (j) { recordApi(url, j); }).catch(function () {});
            } catch (e) {}
          }).catch(function () {});
        }
        return p;
      };
    }

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__bossUrl = url; } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      try {
        if (/api|job|search|geek/i.test(xhr.__bossUrl || '')) {
          xhr.addEventListener('load', function () {
            try { recordApi(xhr.__bossUrl, JSON.parse(xhr.responseText)); } catch (e) {}
          });
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  }

  var panel = document.createElement('div');
  panel.id = 'boss-collect-panel';
  panel.innerHTML =
    '<div style="background:#1890ff;color:#fff;padding:6px 10px;border-radius:8px 8px 0 0;font-size:12px">采集岗位</div>' +
    '<div style="padding:8px 10px;font-size:12px;line-height:1.8" id="boss-collect-stats">准备…</div>' +
    '<div style="padding:0 10px 4px"><button id="boss-collect-run" style="width:100%;padding:6px;border:1px solid #52c41a;background:#f6ffed;color:#52c41a;border-radius:4px;cursor:pointer;font-size:13px">从选中岗位开始采集</button></div>' +
    '<div style="padding:0 10px 4px"><button id="boss-collect-stop" style="width:100%;padding:4px;border:1px solid #ff4d4f;background:#fff;color:#ff4d4f;border-radius:4px;cursor:pointer;font-size:12px">停止并回传</button></div>' +
    '<div style="padding:0 10px 8px"><button id="boss-collect-debug" style="width:100%;padding:4px;border:1px solid #1890ff;background:#fff;color:#1890ff;border-radius:4px;cursor:pointer;font-size:12px">诊断并回传</button></div>';
  Object.assign(panel.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999',
    background: '#fff', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', width: '260px', fontFamily: '"Microsoft YaHei",sans-serif'
  });
  document.body.appendChild(panel);

  function stats(msg) {
    var el = document.getElementById('boss-collect-stats');
    if (el) el.textContent = '已采 ' + cards.length + ' / ' + DETAIL_MAX + ' · 第 ' + (state.detailCursor + 1) + ' 个' + (msg ? ' · ' + msg : '');
  }

  function saveProgress() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ cards: cards, cursor: state.detailCursor }));
    } catch (e) {}
  }

  function decodeBossSalary(s) {
    var map = {
      '\uE031': '0', '\uE032': '1', '\uE033': '2', '\uE034': '3', '\uE035': '4',
      '\uE036': '5', '\uE037': '6', '\uE038': '7', '\uE039': '8', '\uE03A': '9'
    };
    return String(s == null ? '' : s).replace(/[\uE031-\uE03A]/g, function (c) { return map[c] || c; });
  }

  var RADICAL_MAP = {
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
    var out = String(s).normalize('NFKC');
    out = out.replace(/[\u200B-\u200D\uFEFF]/g, '');
    out = out.replace(/[\u2F00-\u2FDB]/g, function (c) { return RADICAL_MAP[c] || c; });
    return out;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getCards() {
    var primary = Array.from(document.querySelectorAll('.job-card-box'));
    if (primary.length) return primary;
    var sels = [
      '.job-card-wrapper', '.job-card-body', '.job-card', '.job-card-wrap',
      '.job-list-box li', '.search-job-result li', '.job-recommend-list li',
      'li[ka*="search-job"]'
    ];
    var best = [];
    for (var i = 0; i < sels.length; i++) {
      var nodes = Array.from(document.querySelectorAll(sels[i]));
      if (nodes.length > best.length) { best = nodes; }
    }
    return best;
  }

  function textOf(card, sels) {
    for (var i = 0; i < sels.length; i++) {
      var el = card.querySelector(sels[i]);
      var t = el && (el.textContent || '').trim();
      if (t) return t;
    }
    return '';
  }

  function vueDataOf(el) {
    try {
      var inst = el.__vue__;
      if (inst) {
        var d = inst.$data || inst;
        var item = d.item || d.job || d.jobInfo || d.jobData;
        if (item && typeof item === 'object' && (item.jobName || item.salaryDesc)) return item;
      }
      var vp = el.__vueParentComponent;
      if (vp) {
        var props = vp.props || {};
        var it = props.item || props.job || props.jobInfo || props.data;
        if (it && typeof it === 'object' && (it.jobName || it.salaryDesc)) return it;
      }
    } catch (e) {}
    return null;
  }

  function apiJobToRecord(item) {
    var title = String(item.jobName || item.jobTitle || '').trim();
    var company = String(item.brandName || item.companyName || '').trim();
    if (!title || !company) return null;
    var j = {
      source: 'boss',
      title: title,
      company: company,
      companyTags: [],
      area: '',
      link: '',
      encryptJobId: String(item.encryptJobId || ''),
      securityId: String(item.securityId || ''),
      salary: item.salaryDesc ? String(item.salaryDesc) : '',
      salaryEncoded: !item.salaryDesc,
      publishedAt: todayStr()
    };
    var parts = [];
    if (item.cityName) parts.push(String(item.cityName));
    if (item.areaDistrict) parts.push(String(item.areaDistrict));
    if (item.businessDistrict) parts.push(String(item.businessDistrict));
    if (parts.length) j.area = parts.join('·');
    j.brandScaleName = item.brandScaleName || '';
    j.brandIndustry = item.brandIndustry || '';
    j.jobExperience = item.jobExperience || '';
    j.jobDegree = item.jobDegree || '';
    j.jobLabels = item.jobLabels || [];
    j.skills = item.skills || [];
    j.welfareList = item.welfareList || [];
    var tags = [];
    (item.jobLabels || []).forEach(function (t) { if (t) tags.push(String(t)); });
    (item.skills || []).forEach(function (t) { if (t) tags.push(String(t)); });
    if (tags.length) j.tags = tags;
    if (item.encryptJobId) {
      j.link = 'https://www.zhipin.com/job_detail/' + item.encryptJobId + '.html';
    }
    return j;
  }

  function isDup(j) {
    return cards.some(function (x) {
      return (j.securityId && x.securityId && x.securityId === j.securityId) ||
        (j.encryptJobId && x.encryptJobId && x.encryptJobId === j.encryptJobId) ||
        (x.company === j.company && x.title === j.title);
    });
  }

  function apiItemFor(j) {
    if (j.securityId && apiJobs[j.securityId]) return apiJobs[j.securityId];
    if (j.encryptJobId && apiJobs[j.encryptJobId]) return apiJobs[j.encryptJobId];
    return null;
  }

  function mergeApi(j) {
    var item = apiItemFor(j);
    if (!item) return j;
    if (item.salaryDesc) { j.salary = String(item.salaryDesc); j.salaryEncoded = false; }
    if (item.brandName) j.company = String(item.brandName);
    if (item.areaDistrict || item.businessDistrict) {
      var parts = [];
      if (item.cityName) parts.push(String(item.cityName));
      if (item.areaDistrict) parts.push(String(item.areaDistrict));
      if (item.businessDistrict) parts.push(String(item.businessDistrict));
      if (parts.length) j.area = parts.join('·');
    }
    j.brandScaleName = item.brandScaleName || '';
    j.brandIndustry = item.brandIndustry || '';
    j.jobExperience = item.jobExperience || '';
    j.jobDegree = item.jobDegree || '';
    j.jobLabels = item.jobLabels || [];
    j.skills = item.skills || [];
    j.welfareList = item.welfareList || [];
    var tags = [];
    (item.jobLabels || []).forEach(function (t) { if (t) tags.push(String(t)); });
    (item.skills || []).forEach(function (t) { if (t) tags.push(String(t)); });
    if (tags.length) j.tags = tags;
    return j;
  }

  function cleanup(j) {
    if (j && j.title) {
      j.title = j.title.replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();
      j.title = normalizeText(j.title);
    }
    if (j && j.company) j.company = normalizeText(j.company);
    return j;
  }

  function classifyTags(tags) {
    var exp = '';
    var deg = '';
    var rest = [];
    (tags || []).forEach(function (t) {
      var s = String(t);
      if (!exp && /应届|在校|实习|经验|年|不限/.test(s)) exp = s;
      else if (!deg && /本科|大专|硕士|博士|高中|学历/.test(s)) deg = s;
      else rest.push(s);
    });
    return { exp: exp, deg: deg, rest: rest };
  }

  function extract(card) {
    var data = vueDataOf(card);
    if (data) {
      var rec = apiJobToRecord(data);
      if (rec) return cleanup(rec);
    }
    var title = textOf(card, ['.job-name', '.job-title', '[class*="job-name"]']);
    var salary = textOf(card, ['.job-salary', '[class*="salary"]']);
    var company = textOf(card, ['.boss-name', '.company-name', '[class*="boss-name"]', '[class*="company-name"]', '[class*="brand-name"]']);
    var area = textOf(card, ['.company-location', '.job-area', '[class*="location"]', '[class*="job-area"]', '[class*="district"]']);
    var tags = Array.from(card.querySelectorAll('.tag-list li, .company-tag-list li, [class*="tag"] li')).map(function (el) { return el.textContent.trim(); }).filter(Boolean);
    var linkEl = card.querySelector('a[href*=job_detail]') || card.querySelector('a[href*=jobDetail]') || card.querySelector('a');
    var href = (linkEl && linkEl.getAttribute('href')) || '';
    var companyLinkEl = card.querySelector('a[href*="/gongsi/"]') || card.querySelector('a.boss-info');
    var companyHref = (companyLinkEl && companyLinkEl.getAttribute('href')) || '';
    var enc = href.match(/job_detail\/([a-zA-Z0-9_\-]+)/i);
    var sec = href.match(/securityId=([a-zA-Z0-9_\-]+)/i);
    var cls = classifyTags(tags);
    return cleanup(mergeApi({
      source: 'boss',
      title: title,
      company: company,
      companyTags: cls.rest,
      area: area,
      link: href ? new URL(href, location.origin).href : '',
      encryptJobId: enc ? enc[1] : '',
      securityId: sec ? sec[1] : '',
      companyLink: companyHref ? new URL(companyHref, location.origin).href : '',
      salary: decodeBossSalary(salary),
      salaryEncoded: /[\uE000-\uF8FF]/.test(decodeBossSalary(salary)),
      jobExperience: cls.exp,
      jobDegree: cls.deg,
      publishedAt: todayStr()
    }));
  }

  function cardEncryptId(card) {
    var a = card.querySelector('a[href*=job_detail]') || card.querySelector('a');
    var href = (a && a.getAttribute('href')) || '';
    var m = href.match(/job_detail\/([a-zA-Z0-9_\-]+)/i);
    return m ? m[1] : '';
  }

  function detailEncryptId() {
    var a = document.querySelector('.job-detail-box a[href*=job_detail]');
    var href = (a && a.getAttribute('href')) || '';
    var m = href.match(/job_detail\/([a-zA-Z0-9_\-]+)/i);
    return m ? m[1] : '';
  }

  function selectedCardIndex(cardsNow) {
    var activeSels = [
      '.job-card-box.active', '.job-card-box.selected', '.job-card-box.current',
      '.job-card-wrapper.active', '.job-card-wrapper.selected',
      '[class*="job-card"][class*="active"]', '[class*="job-card"][class*="selected"]',
      '[class*="job-card"][class*="current"]', 'li[class*="active"]'
    ];
    for (var i = 0; i < activeSels.length; i++) {
      var els = Array.from(document.querySelectorAll(activeSels[i]));
      for (var e = 0; e < els.length; e++) {
        var el = els[e];
        for (var k = 0; k < cardsNow.length; k++) {
          if (cardsNow[k] === el || cardsNow[k].contains(el) || el.contains(cardsNow[k])) return k;
        }
      }
    }
    var enc = detailEncryptId();
    if (enc) {
      for (var m = 0; m < cardsNow.length; m++) {
        if (cardEncryptId(cardsNow[m]) === enc) return m;
      }
    }
    return -1;
  }

  function clickCard(card) {
    try {
      var info = card.querySelector('.job-info');
      (info || card).click();
    } catch (e) {
      try { card.click(); } catch (e2) {}
    }
  }

  function cleanDesc(root) {
    var clone = root.cloneNode(true);
    var junk = clone.querySelectorAll('style, span, i, [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"]');
    for (var i = 0; i < junk.length; i++) { junk[i].remove(); }
    return normalizeText((clone.textContent || '').replace(/\s+/g, ' ').trim());
  }

  function scrapeDetail(card) {
    var titleEl = document.querySelector('.job-detail-box .job-name, .job-detail-box [class*="job-name"]');
    var descEl = document.querySelector('.job-detail-body .desc');
    var bossEl = document.querySelector('.job-boss-info .name');
    var bossAttr = document.querySelector('.job-boss-info .boss-info-attr');
    var addrEl = document.querySelector('.job-address-desc');
    return {
      title: titleEl ? titleEl.textContent.trim() : '',
      salary: (document.querySelector('.job-detail-box .job-salary') || {}).textContent ? decodeBossSalary(document.querySelector('.job-detail-box .job-salary').textContent.trim()) : '',
      description: descEl ? cleanDesc(descEl) : '',
      bossName: bossEl ? bossEl.textContent.trim() : '',
      company: bossAttr ? bossAttr.textContent.trim().split('·')[0].trim() : '',
      address: addrEl ? addrEl.textContent.trim() : ''
    };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function scrollAll() {
    var h = window.innerHeight || 800;
    for (var s = 0; s < 4; s++) {
      window.scrollBy(0, Math.round(h * 0.7));
      await sleep(600);
    }
  }

  async function loadMore() {
    var oldCards = getCards().length;
    await scrollAll();
    for (var w = 0; w < 12; w++) {
      await sleep(500);
      if (getCards().length > oldCards) return true;
    }
    return false;
  }

  var sendPromise = null;
  function send() {
    if (sendPromise) return sendPromise;
    sendPromise = (async function () {
      if (!cards.length) { stats('0 条，未回传'); return; }
      try {
        var resp = await fetch(SERVER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cards)
        });
        var txt = await resp.text();
        var data = {};
        try { data = JSON.parse(txt); } catch (e) {}
        stats('回传成功 · 收到 ' + (data.received != null ? data.received : cards.length) + ' · 展示 ' + (data.shown != null ? data.shown : '?'));
        try { localStorage.removeItem(LS_KEY); } catch (e) {}
      } catch (err) {
        stats('回传失败，请确认采集服务器已启动');
      }
    })();
    return sendPromise;
  }

  document.getElementById('boss-collect-stop').onclick = async function () {
    running = false;
    await send();
    done = true;
    document.getElementById('boss-collect-stop').textContent = '已停止';
  };

  function collectDiagnostics() {
    var res = [];
    try {
      res = performance.getEntriesByType('resource').map(function (e) { return e.name; })
        .filter(function (u) { return /api|job|search|geek/i.test(u); });
    } catch (e) {}
    var cand = {};
    var els = document.querySelectorAll('li, [class*="job"], [class*="card"], [class*="item"], [class*="salary"]');
    for (var i = 0; i < els.length; i++) {
      var txt = (els[i].textContent || '').slice(0, 300);
      if (/K/.test(txt) || /·/.test(txt) || /实习|应届|本科/.test(txt)) {
        var c = typeof els[i].className === 'string' ? els[i].className : '(no-class)';
        cand[c] = (cand[c] || 0) + 1;
      }
    }
    var sample = '';
    try {
      var c0 = document.querySelector('.job-card-box');
      if (c0) sample = c0.outerHTML.slice(0, 3000);
    } catch (e) {}
    var detailSample = '';
    try {
      var dd = document.querySelector('.job-detail-container, .job-detail-box, [class*="job-detail"], [class*="detail-container"]');
      if (dd) detailSample = dd.outerHTML.slice(0, 6000);
    } catch (e) {}
    var isCompany = /\/gongsi\//i.test(location.href);
    var companySample = '';
    try {
      if (isCompany) {
        var cc = document.querySelector('.company-info, [class*="company-detail"], [class*="company-info"], [class*="company-box"], .job-detail');
        if (cc) companySample = cc.outerHTML.slice(0, 8000);
      }
    } catch (e) {}
    return {
      url: location.href,
      time: new Date().toISOString(),
      state: { apiCount: state.apiCount, apiJobKeys: Object.keys(apiJobs).length, detailCursor: state.detailCursor },
      jobDetailLinks: document.querySelectorAll('a[href*="job_detail"], a[href*="jobDetail"]').length,
      salaryEls: document.querySelectorAll('[class*="salary"]').length,
      apiResources: res.slice(0, 30),
      candidateClasses: cand,
      sampleCardHtml: sample,
      detailSampleHtml: detailSample,
      isCompany: isCompany,
      companySampleHtml: companySample
    };
  }

  async function postDiagnostics() {
    try {
      await fetch(DEBUG, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectDiagnostics())
      });
    } catch (err) {}
  }

  document.getElementById('boss-collect-debug').onclick = async function () {
    await postDiagnostics();
    stats('诊断已回传');
  };

  function sectionText(sec) {
    var lis = sec.querySelectorAll('li');
    if (lis.length) {
      return Array.from(lis).map(function (li) { return (li.textContent || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
    }
    var rows = sec.querySelectorAll('tr');
    if (rows.length) {
      return Array.from(rows).map(function (tr) {
        var cells = Array.from(tr.querySelectorAll('th,td')).map(function (c) { return (c.textContent || '').trim(); });
        return cells.join('：');
      }).filter(Boolean).join('\n');
    }
    return (sec.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function fetchCompany(url) {
    state.companyCache = state.companyCache || {};
    if (state.companyCache[url]) return state.companyCache[url];
    var result = { companyUrl: url, intro: '', gongshang: '', tags: '' };
    try {
      var resp = await fetch(url, { credentials: 'include' });
      var html = await resp.text();
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var box = doc.querySelector('.company-info-box') || doc.body;
      var sections = {};
      var secs = box.querySelectorAll('.job-sec');
      for (var i = 0; i < secs.length; i++) {
        var h3 = secs[i].querySelector('h3');
        var title = h3 ? h3.textContent.trim() : '';
        if (title) sections[title] = sectionText(secs[i]);
      }
      result.intro = (sections['公司简介'] || '').replace(/^公司简介/, '').trim();
      result.gongshang = (sections['工商信息'] || '').replace(/^工商信息/, '').trim();
      result.tags = (sections['公司标签'] || '').replace(/^公司标签/, '').trim();
      result.sections = sections;
    } catch (e) {
      result.error = String(e);
    }
    state.companyCache[url] = result;
    return result;
  }

  async function run() {
    if (running) { stats('已在采集'); return; }
    running = true;
    done = false;

    installHooks();
    window.__bossCollect = state;

    var picked = selectedCardIndex(getCards());
    if (picked >= 0) {
      state.detailCursor = picked;
    } else {
      stats('未检测到选中岗位，将从第 ' + (state.detailCursor + 1) + ' 个继续');
    }
    stats('从第 ' + (state.detailCursor + 1) + ' 个开始…');
    while (running && cards.length < DETAIL_MAX && !done) {
      var cardsNow = getCards();
      var idx = state.detailCursor;
      if (idx >= cardsNow.length) {
        if (!(await loadMore())) { stats('已到底，共 ' + cards.length + ' 条'); break; }
        continue;
      }
      var card = cardsNow[idx];
      try { card.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      var j = extract(card);
      var enc = cardEncryptId(card);
      clickCard(card);
      var ok = false;
      for (var w = 0; w < 20; w++) {
        await sleep(400);
        if (enc && detailEncryptId() === enc) { ok = true; break; }
      }
      if (ok) {
        await sleep(300);
        var d = scrapeDetail(card);
        if (d.description) j.description = d.description;
        if (d.address) { j.address = d.address; j.area = d.address; }
        if (d.bossName) j.bossName = d.bossName;
        if (!j.company && d.company) j.company = d.company;
        if (d.salary && !j.salary) j.salary = d.salary;
      }
      if (j.companyLink && !j.companyInfo) {
        try {
          var ci = await fetchCompany(j.companyLink);
          j.companyInfo = ci;
          j.companyIntro = ci.intro || '';
          j.companyGongshang = ci.gongshang || '';
        } catch (e) {}
      }
      if (j.title && j.company && !isDup(j)) { cards.push(j); }
      state.detailCursor = state.detailCursor + 1;
      saveProgress();
      stats((ok ? '详情OK' : '无详情') + ' · ' + (j.title || '').slice(0, 12));
    }
    running = false;
    await send();
    if (cards.length === 0) {
      stats('0 条，已自动回传诊断');
      await postDiagnostics();
    }
  }

  document.getElementById('boss-collect-run').onclick = function () { run(); };
  stats('就绪 · 先在页面点选一个岗位，再点「从选中岗位开始采集」');
})();