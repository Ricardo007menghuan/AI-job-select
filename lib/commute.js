'use strict';

const config = require('../config/config.json');

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function estimateMinutes(lng, lat) {
  const home = config.home;
  const km = haversineKm(home.lat, home.lng, lat, lng);
  const detourKm = km * 1.35;
  const minutes = Math.round((detourKm / 32) * 60 + 12);
  return { km: Math.round(km * 10) / 10, minutes, estimated: true };
}

async function estimateMinutesWithApi(lng, lat) {
  const home = config.home;
  const key = config.map_api && config.map_api.key;
  if (!key) return estimateMinutes(lng, lat);

  const origin = `${home.lng},${home.lat}`;
  const destination = `${lng},${lat}`;
  const url = 'https://restapi.amap.com/v3/direction/transit/integrated' +
    `?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}&city=${encodeURIComponent(config.city)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === '1' && data.route && data.route.transits && data.route.transits.length) {
      const transit = data.route.transits[0];
      return {
        km: Math.round((transit.distance / 1000) * 10) / 10,
        minutes: Math.round(transit.duration / 60),
        estimated: false,
      };
    }
  } catch (err) {
    // 回退到本地估算
  }
  return estimateMinutes(lng, lat);
}

function priorityFor(minutes, thresholds) {
  if (minutes <= thresholds.near) return 'high';
  if (minutes <= thresholds.prefer) return 'normal';
  return 'low';
}

module.exports = { haversineKm, estimateMinutes, estimateMinutesWithApi, priorityFor };