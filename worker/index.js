import { generateMidVFromEnv } from './openpoint-midv.mjs';

const OPENPOINT_BASE = 'https://lovefood.openpoint.com.tw/LoveFood/api/';
const MAX_BODY_BYTES = 10_000;
const MAX_MAP_HTML_BYTES = 256_000;
const MAP_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'google.com', 'www.google.com', 'maps.google.com']);
const OPENPOINT_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
// v2 prevents a pre-migration Farmer token from masking the first direct mid_v exchange.
const ACCESS_TOKEN_CACHE_URL = 'https://ilovefood.imstevelin.com/__internal/openpoint-access-token-v2';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isDynamicRoute = url.pathname === '/health' || url.pathname.startsWith('/api/');
    if (!isDynamicRoute) return env.ASSETS.fetch(request);

    const origin = request.headers.get('Origin');
    const isPrimarySiteRequest = url.hostname === 'ilovefood.imstevelin.com' && (!origin || origin === url.origin);
    const allowedOrigins = new Set(
      (env.ALLOWED_ORIGINS || 'https://ilovefood.imstevelin.com')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    );

    if (request.method === 'OPTIONS') {
      return origin && (allowedOrigins.has(origin) || isPrimarySiteRequest)
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : json({ error: 'Origin not allowed' }, 403);
    }

    if (url.pathname === '/health') return json({ status: 'ok' });
    if (!isPrimarySiteRequest && (!origin || !allowedOrigins.has(origin))) {
      return json({ error: 'Origin not allowed' }, 403);
    }

    const callerOrigin = origin || url.origin;

    const rateLimitResponse = await enforceRateLimit(request, env, callerOrigin);
    if (rateLimitResponse) return withCors(rateLimitResponse, callerOrigin);

    try {
      let response;
      if (request.method === 'GET' && url.pathname === '/api/maps/resolve') {
        response = await resolveMapsUrl(url.searchParams.get('url'));
      } else if (request.method === 'GET' && url.pathname === '/api/7eleven/categories') {
        response = await openPointRequest(env, 'Master/FrontendItemCategory/GetList');
      } else if (request.method === 'POST' && url.pathname === '/api/7eleven/stores/search') {
        const body = await readJsonBody(request);
        const keyword = String(body.keyword || '').trim();
        if (!keyword || keyword.length > 80) return withCors(json({ error: 'Invalid keyword' }, 400), callerOrigin);
        response = await openPointRequest(env, 'Master/FrontendStore/GetStoreByAddress', {}, { keyword });
      } else if (request.method === 'POST' && url.pathname === '/api/7eleven/stores/nearby') {
        const body = await readJsonBody(request);
        validateLocationBody(body);
        response = await openPointRequest(env, 'Search/FrontendStoreItemStock/GetNearbyStoreList', body);
      } else {
        const match = url.pathname.match(/^\/api\/7eleven\/stores\/([A-Za-z0-9_-]{1,20})\/inventory$/);
        if (request.method !== 'POST' || !match) return withCors(json({ error: 'Not found' }, 404), callerOrigin);
        const body = await readJsonBody(request);
        validatePoint(body.CurrentLocation);
        response = await openPointRequest(
          env,
          'Search/FrontendStoreItemStock/GetStoreDetail',
          { storeNo: match[1], CurrentLocation: body.CurrentLocation }
        );
      }
      return withCors(json(response), callerOrigin);
    } catch (error) {
      const status = Number(error.status) || 502;
      console.error(JSON.stringify({
        message: 'Worker request failed',
        path: url.pathname,
        status,
        error: error instanceof Error ? error.message : String(error)
      }));
      return withCors(json({ error: status < 500 ? error.message : 'Upstream service unavailable' }, status), callerOrigin);
    }
  }
};

async function enforceRateLimit(request, env, origin) {
  if (!env.API_RATE_LIMITER?.limit) return null;
  const forwarded = request.headers.get('CF-Connecting-IP') || 'unknown';
  const result = await env.API_RATE_LIMITER.limit({ key: `${origin}:${forwarded}` });
  return result.success ? null : json({ error: 'Too many requests' }, 429, { 'Retry-After': '60' });
}

async function resolveMapsUrl(rawUrl) {
  if (!rawUrl || rawUrl.length > 2_048) throw httpError(400, 'Invalid Maps URL');
  let target = validateMapsUrl(rawUrl);
  let html = '';

  for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-TW,zh;q=0.9'
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (!location) throw httpError(502, 'Maps redirect missing Location');
      target = validateMapsUrl(new URL(location, target).toString());
      // maps.app.goo.gl 與舊版 goo.gl/maps 的第一個安全重新導向就是可供前端解析的完整網址。
      // 不再下載龐大的 Google Maps HTML（常超過 700 KB），可避免 Worker 無謂耗用頻寬與記憶體。
      if (target.hostname !== 'maps.app.goo.gl' && target.hostname !== 'goo.gl') {
        return { resolvedUrl: target.toString(), coordinates: [] };
      }
      continue;
    }

    if (!response.ok) throw httpError(502, 'Maps request failed');
    const declaredLength = Number(response.headers.get('Content-Length') || 0);
    if (declaredLength > MAX_MAP_HTML_BYTES) throw httpError(413, 'Maps response too large');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_MAP_HTML_BYTES) throw httpError(413, 'Maps response too large');
    html = new TextDecoder().decode(bytes);
    break;
  }

  const coordinates = [];
  const seen = new Set();
  const coordinatePattern = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/g;
  let match;
  while ((match = coordinatePattern.exec(html)) && coordinates.length < 12) {
    const point = { lat: Number(match[1]), lng: Number(match[2]) };
    const key = `${point.lat},${point.lng}`;
    if (!seen.has(key)) {
      seen.add(key);
      coordinates.push(point);
    }
  }
  return { resolvedUrl: target.toString(), coordinates };
}

function validateMapsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !MAP_HOSTS.has(url.hostname)) {
    throw httpError(400, 'Unsupported Maps URL');
  }
  if (url.hostname === 'goo.gl' && !url.pathname.startsWith('/maps')) {
    throw httpError(400, 'Unsupported Maps URL');
  }
  return url;
}

async function openPointRequest(env, endpoint, body = {}, query = {}, canRetry = true) {
  const token = await getAccessToken(env);
  const url = new URL(endpoint, OPENPOINT_BASE);
  url.searchParams.set('token', token);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-TW,zh;q=0.9',
      'User-Agent': OPENPOINT_USER_AGENT
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (response.ok && payload && payload.isSuccess !== false && payload.element !== undefined) return payload;

  if (canRetry) {
    await caches.default.delete(createAccessTokenCacheKey());
    return openPointRequest(env, endpoint, body, query, false);
  }
  throw httpError(502, 'OPENPOINT request failed');
}

async function getAccessToken(env) {
  const cached = await caches.default.match(createAccessTokenCacheKey());
  if (cached) {
    const token = await cached.text();
    if (token) return token;
  }

  const midV = await generateMidVFromEnv(env);
  const accessUrl = new URL('Auth/FrontendAuth/AccessToken', OPENPOINT_BASE);
  accessUrl.searchParams.set('mid_v', midV);
  const accessResponse = await fetch(accessUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-TW,zh;q=0.9',
      'User-Agent': OPENPOINT_USER_AGENT
    },
    body: '{}'
  });
  const accessPayload = await accessResponse.json().catch(() => null);
  if (!accessResponse.ok || accessPayload?.isSuccess === false || !accessPayload?.element) {
    throw httpError(503, 'Unable to obtain OPENPOINT access');
  }

  const token = String(accessPayload.element);
  await caches.default.put(createAccessTokenCacheKey(), new Response(token, {
    headers: { 'Cache-Control': 'public, max-age=240' }
  }));
  return token;
}

function createAccessTokenCacheKey() {
  return new Request(ACCESS_TOKEN_CACHE_URL);
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) throw httpError(413, 'Request body too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw httpError(413, 'Request body too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw httpError(400, 'Invalid JSON');
  }
}

function validateLocationBody(body) {
  validatePoint(body?.CurrentLocation);
  validatePoint(body?.SearchLocation);
}

function validatePoint(point) {
  const latitude = Number(point?.Latitude);
  const longitude = Number(point?.Longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 20 || latitude > 27 || longitude < 118 || longitude > 123) {
    throw httpError(400, 'Location must be within Taiwan');
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
