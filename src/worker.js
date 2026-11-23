// Worker: melindungi API key TomTom dan menyediakan pencarian alamat.
// Semua rute /api/* butuh header x-app-pin yang cocok dengan secret APP_PIN.

const TOMTOM = 'https://api.tomtom.com';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'catatan-narik/1.0 (catatan pribadi driver)';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function pinOk(request, env) {
  if (!env.APP_PIN) return false;
  const [a, b] = await Promise.all([sha256(request.headers.get('x-app-pin') || ''), sha256(env.APP_PIN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const validPoint = (p) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

function thin(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

async function tomtomRoute(env, from, to, mode, departAt) {
  const params = new URLSearchParams({
    key: env.TOMTOM_KEY,
    travelMode: mode,
    traffic: 'true',
    routeType: 'fastest',
    maxAlternatives: '2',
    computeTravelTimeFor: 'all',
  });
  if (departAt) params.set('departAt', departAt);
  const path = `/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json`;
  return fetch(`${TOMTOM}${path}?${params}`, { headers: { 'user-agent': UA } });
}

async function handleRoute(request, env) {
  if (request.method !== 'POST') return json({ error: 'Gunakan POST.' }, 405);
  if (!env.TOMTOM_KEY) return json({ error: 'TOMTOM_KEY belum diatur di Cloudflare.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body bukan JSON.' }, 400); }
  const { from, to } = body || {};
  if (!validPoint(from) || !validPoint(to)) return json({ error: 'Titik asal atau tujuan tidak valid.' }, 400);
  let departAt = null;
  if (typeof body.departAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/.test(body.departAt)) {
    departAt = body.departAt;
  }

  let mode = 'motorcycle';
  let res = await tomtomRoute(env, from, to, mode, departAt);
  if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 403) {
    mode = 'car';
    res = await tomtomRoute(env, from, to, mode, departAt);
  }
  if (!res.ok) {
    const map = { 403: 'API key TomTom ditolak. Cek TOMTOM_KEY.', 429: 'Kuota TomTom bulan ini habis.' };
    return json({ error: map[res.status] || `TomTom membalas ${res.status}.`, status: res.status }, 502);
  }
  const data = await res.json();
  const routes = (data.routes || []).map((r, i) => {
    const s = r.summary || {};
    const pts = (r.legs || []).flatMap((l) => l.points || []).map((p) => [
      Math.round(p.latitude * 1e5) / 1e5,
      Math.round(p.longitude * 1e5) / 1e5,
    ]);
    return {
      index: i,
      meters: s.lengthInMeters,
      seconds: s.travelTimeInSeconds,
      delaySeconds: s.trafficDelayInSeconds || 0,
      noTrafficSeconds: s.noTrafficTravelTimeInSeconds ?? null,
      points: thin(pts, 300),
    };
  });
  return json({ mode, routes });
}

async function handleGeocode(url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
  if (q.length < 3) return json({ error: 'Tulis minimal 3 huruf.' }, 400);
  const params = new URLSearchParams({ format: 'jsonv2', q, countrycodes: 'id', limit: '5' });
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    params.set('viewbox', `${lon - 0.5},${lat + 0.5},${lon + 0.5},${lat - 0.5}`);
  }
  const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: { 'user-agent': UA } });
  if (!res.ok) return json({ error: 'Pencarian alamat sedang gagal.' }, 502);
  const list = await res.json();
  return json({
    results: list.map((x) => ({ name: x.display_name, lat: parseFloat(x.lat), lon: parseFloat(x.lon) })),
  });
}

async function handleReverse(url) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  if (!validPoint({ lat, lon })) return json({ error: 'Koordinat tidak valid.' }, 400);
  const params = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '16', addressdetails: '1' });
  const res = await fetch(`${NOMINATIM}/reverse?${params}`, { headers: { 'user-agent': UA } });
  if (!res.ok) return json({ error: 'Nama area belum bisa dicari.' }, 502);
  const d = await res.json();
  const a = d.address || {};
  const area = a.suburb || a.neighbourhood || a.village || a.city_district || a.town || a.city || a.county || '';
  return json({ area, display: d.display_name || '' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    if (!(await pinOk(request, env))) return json({ error: 'PIN salah atau belum diatur.' }, 401);
    try {
      if (url.pathname === '/api/ping') return json({ ok: true });
      if (url.pathname === '/api/route') return await handleRoute(request, env);
      if (url.pathname === '/api/geocode') return await handleGeocode(url);
      if (url.pathname === '/api/reverse') return await handleReverse(url);
      return json({ error: 'Tidak ditemukan.' }, 404);
    } catch (e) {
      return json({ error: 'Terjadi kesalahan di server.' }, 500);
    }
  },
};
