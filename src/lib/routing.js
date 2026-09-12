import { defaultSleep, fetchWithTimeout } from './http.js'

const VALHALLA_ROUTE_URL = 'https://valhalla1.openstreetmap.de/route'

// Valhalla公開デモサーバ（FOSSGIS運営）のfair use方針（OSRM/Nominatim同様の
// レート制限）を連続クリック等でも守るための、モジュール内で共有する直近呼び出し時刻。
const MIN_INTERVAL_MS = 1000
let lastCallAt = 0

/**
 * 複数点を経由する道路沿いtrkpt列を返す。Valhalla公開APIを使用（bicycle固定）。
 * OSRM互換の応答形式（format=osrm, shape_format=geojson）でリクエストするため、
 * 応答の座標パース処理はOSRMと同一。自転車専用道（サイクリングロード等）も
 * 経路探索の対象道路網に含まれる（spec.txt 9章・17-1章）。
 * 失敗時は points をそのまま返す（直線フォールバック）。
 * points: [[lat, lon], ...]
 */
export async function calcRouteSegment(
  points,
  { fetchImpl = fetch, timeoutMs = 30000, sleep = defaultSleep, now = () => Date.now() } = {}
) {
  const wait = MIN_INTERVAL_MS - (now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = now()

  const body = {
    locations: points.map(([lat, lon]) => ({ lat, lon })),
    costing: 'bicycle',
    format: 'osrm',
    shape_format: 'geojson',
    overview: 'full',
  }
  try {
    const res = await fetchWithTimeout(VALHALLA_ROUTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': 'gpx-editor' },
      body: JSON.stringify(body),
      fetchImpl,
      timeoutMs,
    })
    if (!res.ok) return points
    const data = await res.json()
    if (data.code !== 'Ok') return points
    return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon])
  } catch {
    return points
  }
}
