'use strict';

const fs = require('fs');
const path = require('path');
const { backfillEmployeeReviews } = require('../lib/company-audit');
const { writeReport } = require('../lib/aggregate');

const DATA_DIR = path.join(__dirname, '..', 'data');
const source = process.argv[2] || 'jobs-today.json';
const jobs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, source), 'utf8'));

(async () => {
  console.log('开始为 ' + jobs.length + ' 条岗位回填员工口碑...');
  const updated = await backfillEmployeeReviews(jobs, DATA_DIR);
  const withReviews = updated.filter((r) => r && Array.isArray(r.employeeReviews) && r.employeeReviews.length).length;
  console.log('完成：' + updated.length + ' 家公司，其中 ' + withReviews + ' 家已有员工口碑');
  const report = writeReport(jobs, DATA_DIR);
  console.log('报告已更新：' + report.length + ' 条');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
