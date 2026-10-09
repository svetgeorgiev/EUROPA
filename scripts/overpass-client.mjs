/**
 * EUROPA's one-shot, developer-operated OpenStreetMap Overpass downloader.
 * No browser requests and no per-player API usage. Respect public API limits.
 */
export const DEFAULT_OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]);

export function listOverpassEndpoints(customUrl) {
  const urls = [customUrl, ...DEFAULT_OVERPASS_ENDPOINTS].filter(Boolean);
  for (const url of urls) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Overpass endpoint must use HTTP(S): ' + url);
    }
  }
  return [...new Set(urls)];
}

const APP_URL = 'https://github.com/svetgeorgiev/EUROPA';
export const OVERPASS_HEADERS = Object.freeze({
  'user-agent': 'EUROPA-OSM-Importer/0.1 (+https://github.com/svetgeorgiev/EUROPA; contact via GitHub issues)',
  'referer': APP_URL,
  'accept': 'application/json',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
});

function responseMessage(body) {
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function requestOverpass(query, {
  endpoints = DEFAULT_OVERPASS_ENDPOINTS,
  fetchImpl = fetch,
  pause = sleep,
  logger = console,
  timeoutMs = 75000,
  cooldownMs = 30000,
} = {}) {
  if (!query || typeof query !== 'string') throw new Error('Overpass query must be a nonempty string');
  if (!endpoints.length) throw new Error('No Overpass endpoints configured');
  let lastError;
  for (const [index, endpoint] of endpoints.entries()) {
    let status;
    try {
      logger.info('Requesting OpenStreetMap data from ' + endpoint + ' (timeout ' + Math.round(timeoutMs / 1000) + 's)...');
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: OVERPASS_HEADERS,
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      if (!response.ok) {
        const detail = responseMessage(await response.text());
        throw new Error('HTTP ' + status + ' at ' + endpoint + (detail ? ': ' + detail : ''));
      }
      const data = await response.json();
      if (!Array.isArray(data?.elements)) throw new Error('Invalid Overpass JSON: missing elements array');
      logger.info('Overpass request completed successfully.');
      return data;
    } catch (error) {
      lastError = error;
      logger.warn('Overpass endpoint failed: ' + String(error));
      if (index < endpoints.length - 1 && (status === 406 || status === 429)) {
        logger.warn('Server requested a pause (HTTP ' + status + '); waiting ' + Math.ceil(cooldownMs / 1000) + 's before trying the next endpoint.');
        await pause(cooldownMs);
      }
    }
  }
  throw new Error('OpenStreetMap download failed on all endpoints. Do not repeat immediately after 429/406; retry later or import a saved Overpass JSON export with --input. Last error: ' + String(lastError));
}
