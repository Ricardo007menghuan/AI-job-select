'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../config/config.json');
const { fetchJobs: fetchBoss } = require('../lib/sources/boss');
const { writeReport } = require('../lib/aggregate');

async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const jobs = [];
  if (config.sources.boss.enabled) {
    const keyword = (config.search_keywords || []).join(' ');
    const bossJobs = await fetchBoss({
      config,
      keyword,
      limit: config.sources.boss.daily_limit,
      userDataDir: path.join(dataDir, 'boss-profile'),
    });
    jobs.push(...bossJobs);
  }

  const report = writeReport(jobs, dataDir);
  console.log(`共收集 ${report.length} 条岗位，已写入 data/report.html 与 data/jobs-latest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});