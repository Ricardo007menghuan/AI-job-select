'use strict';

const config = require('../config/config.json');

function yearsSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function capitalToWan(input) {
  const s = String(input || '');
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let v = parseFloat(m[1]);
  if (/亿/.test(s)) v *= 10000;
  if (/美元|\$|USD/i.test(s)) v *= 7;
  if (!/万/.test(s) && !/亿/.test(s)) v = v / 10000;
  return v;
}

function passesCompany(company) {
  const district = String(company.district || company.address || '');
  const inDistrict = config.districts.some((d) => district.includes(d) || d.includes(district));
  const age = yearsSince(company.establishedDate || company.foundedAt);
  const capitalWan = capitalToWan(company.registeredCapital);
  const minAge = config.company_filter.min_founded_years;
  const minCapital = config.company_filter.min_registered_capital_wan;
  const ok = inDistrict && age !== null && age >= minAge && capitalWan >= minCapital;
  return {
    ok,
    inDistrict,
    age: age === null ? null : Math.floor(age),
    capitalWan,
  };
}

module.exports = { passesCompany, capitalToWan, yearsSince };