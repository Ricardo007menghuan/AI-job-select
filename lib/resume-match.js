'use strict';

const config = require('../config/config.json');

function normalize(s) {
  return String(s || '').toLowerCase();
}

function score(job) {
  const text = normalize([job.title, job.description, job.tags, job.companyTags].filter(Boolean).join(' '));
  const primary = config.resume_keywords.primary || [];
  const secondary = config.resume_keywords.secondary || [];
  let total = 0;
  let primaryHits = 0;
  let secondaryHits = 0;
  for (const kw of primary) {
    if (text.includes(normalize(kw))) {
      total += 20;
      primaryHits += 1;
    }
  }
  for (const kw of secondary) {
    if (text.includes(normalize(kw))) {
      total += 8;
      secondaryHits += 1;
    }
  }
  if (primaryHits >= 2) total += 12;
  return { score: Math.min(total, 100), primaryHits, secondaryHits };
}

function addScore(job) {
  const r = score(job);
  job.matchScore = r.score;
  job.primaryHits = r.primaryHits;
  job.secondaryHits = r.secondaryHits;
  return job;
}

module.exports = { score, addScore };