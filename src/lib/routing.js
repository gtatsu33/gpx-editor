import { defaultSleep, fetchWithTimeout } from './http.js'
import { haversine } from './geo.js'

const VALHALLA_ROUTE_URL = 'https://valhalla1.openstreetmap.de/route'

// Valhalla公開デモサーバ（FOSSGIS運営）のfair use方針（OSRM/Nominatim同様の
// レート制限）を連続クリック等でも守るための、モジュール内で共有する直近呼び出し時刻。
const MIN_INTERVAL_MS = 1000
let lastCallAt = 0

async function requestRoute(points, costing, { fetchImpl, timeoutMs, sleep, now }) {
  const wait = MIN_INTERVAL_MS - (now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = now()

  const body = {
    locations: points.map(([lat, lon]) => ({ lat, lon })),
    costing,
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
    if (!res.ok) return null
    const data = await res.json()
    if (data.code !== 'Ok') return null
    return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon])
  } catch {
    return null
  }
}

function routeLength(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
  }
  return total
}

/**
 * 複数点を経由する道路沿いtrkpt列を返す。Valhalla公開APIを使用（bicycle固定）。
 * OSRM互換の応答形式（format=osrm, shape_format=geojson）でリクエストするため、
 * 応答の座標パース処理はOSRMと同一。自転車専用道（サイクリングロード等）も
 * 経路探索の対象道路網に含まれる（spec.txt 9章・17-1章）。
 *
 * pedestrianFallback（デフォルトtrue）がtrueの場合、bicycle costingに加えて
 * pedestrian costingでも計算し、総距離が短い方を採用する。bicycle costingは
 * bicycleタグのない歩道を大きく迂回してでも自転車専用道路網内で強引に
 * つなげてしまうため、失敗時フォールバックでは検出できない「細切れ」を
 * 距離比較によって回避する（spec.txt 9章・17-1章、2026-09-21改訂）。
 *
 * 失敗時（両costingとも失敗）は points をそのまま返す（直線フォールバック）。
 * points: [[lat, lon], ...]
 */
export async function calcRouteSegment(
  points,
  { fetchImpl = fetch, timeoutMs = 30000, sleep = defaultSleep, now = () => Date.now(), pedestrianFallback = true } = {}
) {
  const opts = { fetchImpl, timeoutMs, sleep, now }
  const bicycleResult = await requestRoute(points, 'bicycle', opts)

  if (!pedestrianFallback) {
    return bicycleResult ?? points
  }

  const pedestrianResult = await requestRoute(points, 'pedestrian', opts)

  if (bicycleResult && pedestrianResult) {
    return routeLength(pedestrianResult) < routeLength(bicycleResult) ? pedestrianResult : bicycleResult
  }
  return bicycleResult ?? pedestrianResult ?? points
}
