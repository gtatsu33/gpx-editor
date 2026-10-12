import { defaultSleep, fetchWithTimeout } from './http.js'
import { haversine } from './geo.js'
import { extractTurnsFromSteps } from './turns.js'

const VALHALLA_ROUTE_URL = 'https://valhalla1.openstreetmap.de/route'

// Valhalla公開デモサーバ（FOSSGIS運営）のfair use方針（OSRM/Nominatim同様の
// レート制限）を連続クリック等でも守るための、モジュール内で共有する直近呼び出し時刻。
const MIN_INTERVAL_MS = 1000
let lastCallAt = 0

// bicycle/pedestrianのスナップ距離差がこの値(m)を超えたら、経路の総距離に
// 関わらずスナップ距離が小さい方（ドラッグした地点に忠実な方）を優先する。
// スナップ差がこれ以下なら、両costingとも指定地点に十分正確にスナップできて
// いるとみなし、経路の総距離が短い方を採用する（spec.txt 9章・17-1章）。
const SNAP_DISTANCE_THRESHOLD_M = 3

// spec.txt 9章（2026-09-27追加）: 「歩道もルート候補に含める」トグルOFF時、
// bicycle costingのuse_roads（0〜1、車道と一緒に走ることへの許容度。既定0.25
// ＝分離歩道・自転車道を好む方向）を最大値にして車道を強く優先させる。
// bicycle=yes等のタグ付き歩道はValhalla側の除外対象にならないため
// （17-1章参照）、これは「除外」ではなく「わずかな時短では歩道を選ばせない」
// という重み付けの調整であり、絶対的な除外ではない。
const USE_ROADS_AVOID_SIDEWALKS = 1

/**
 * 連続する同一座標を除去し、turns[].index（元coordsに対する絶対インデックス）を
 * 除去後のcoordsに合わせて振り直す。spec.txt 9章（2026-10-12追加）。
 * Valhallaは始点・終点が道路形状の頂点と一致すると同一座標を2回返すことがあり
 * （実測）、そのまま使うと長さ0の区間が偽のターンを作る。
 */
export function removeConsecutiveDuplicates(coords, turns, kinds = null) {
  const kept = []
  const keptKinds = []
  const newIndexOf = []
  coords.forEach((c, i) => {
    const prev = kept[kept.length - 1]
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) {
      kept.push(c)
      keptKinds.push(kinds ? kinds[i] : 1)
    } else if (kinds) {
      // 統合された座標は、いずれかがトンネルならトンネルとする
      keptKinds[keptKinds.length - 1] = Math.max(keptKinds[keptKinds.length - 1], kinds[i])
    }
    newIndexOf.push(kept.length - 1)
  })
  return {
    coords: kept,
    turns: turns.map((t) => ({ ...t, index: newIndexOf[t.index] ?? t.index })),
    kinds: kinds ? keptKinds : null,
  }
}

/**
 * Valhallaの応答（OSRM形式）のintersections[].classes（"tunnel"）から、座標ごとの
 * 構造種別を作る。spec.txt 13-5章。0=未検証/1=地表/2=トンネル/3=橋。
 * geometry_indexの交差点がtunnelクラスを持つ場合、その交差点から次の交差点までの
 * 辺がトンネルで、両端の座標（出入口）を含めて2とする。橋の情報は応答に含まれないため
 * 3は付けない（それ以外は1）。
 */
export function extractStructureKinds(steps, coordCount) {
  const kinds = new Array(coordCount).fill(1)
  const ix = steps.flatMap((s) => s.intersections ?? []).filter((x) => Number.isInteger(x.geometry_index))
  ix.forEach((x, k) => {
    if (!x.classes?.includes('tunnel')) return
    const from = x.geometry_index
    const to = k + 1 < ix.length ? ix[k + 1].geometry_index : from
    for (let i = from; i <= to && i < coordCount; i++) kinds[i] = 2
  })
  return kinds
}

async function requestRoute(points, costing, { fetchImpl, timeoutMs, sleep, now, costingOptions }) {
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
  if (costingOptions) {
    body.costing_options = { [costing]: costingOptions }
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
    const rawCoords = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon])
    const snapDistance = Math.max(0, ...(data.waypoints ?? []).map((w) => w.distance ?? 0))
    // spec.txt 9章・11章（2026-09-27追加）: 応答のmaneuverからターン候補を
    // 同時に抽出する。indexはcoords配列（両端点を含む）に対応する絶対インデックス。
    const steps = (data.routes[0].legs ?? []).flatMap((leg) => leg.steps ?? [])
    const { coords, turns, kinds } = removeConsecutiveDuplicates(
      rawCoords,
      extractTurnsFromSteps(steps),
      extractStructureKinds(steps, rawCoords.length)
    )
    return { coords, snapDistance, turns, kinds }
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
 * pedestrian costingでも計算する。bicycle costingは、bicycleタグのない歩道を
 * 指定地点から離れた車道に大きくスナップしてでも自転車専用道路網内で強引に
 * つなげてしまうことがある（Valhalla本体の既知の制限。失敗時フォールバックでは
 * 検出できない）。そのため、まずOSRM互換レスポンスのwaypoints[].distance
 * （指定地点から実際にスナップされた地点までの距離）を比較し、
 * その差がSNAP_DISTANCE_THRESHOLD_Mを超える場合は、スナップ距離が小さい方
 * （＝ドラッグした地点に忠実な方）を採用する。差が閾値以内であれば、両者とも
 * 指定地点に十分正確にスナップできているとみなし、経路の総距離が短い方を
 * 採用する（spec.txt 9章・17-1章、2026-09-21改訂）。
 *
 * 失敗時（両costingとも失敗）は points をそのまま返す（直線フォールバック）。
 * points: [[lat, lon], ...]
 *
 * pedestrianFallback: false（「歩道もルート候補に含める」トグルOFF）の場合、
 * bicycle costingにuse_roads: 1（USE_ROADS_AVOID_SIDEWALKS）を指定し、車道を
 * 強く優先させる（2026-09-27追加。上記USE_ROADS_AVOID_SIDEWALKSの説明参照）。
 * pedestrianFallback: true（既定）の場合はこの指定を行わず、Valhallaの既定
 * 挙動のまま（既存動作を変えない）。
 *
 * 戻り値: { coords, turns }。turnsは採用された経路のmaneuverから抽出した
 * ターン候補（spec.txt 9章・11章、2026-09-27追加）。coordsはindex空間を共有する
 * ([[lat,lon],...]、両端点を含む)。フォールバック時（両costing失敗）はturns=[]、kinds=null（未検証）。
 * kindsは座標ごとの構造種別（extractStructureKinds）。
 */
export async function calcRouteSegment(
  points,
  { fetchImpl = fetch, timeoutMs = 30000, sleep = defaultSleep, now = () => Date.now(), pedestrianFallback = true } = {}
) {
  const opts = { fetchImpl, timeoutMs, sleep, now }
  const bicycleCostingOptions = pedestrianFallback ? undefined : { use_roads: USE_ROADS_AVOID_SIDEWALKS }
  const bicycleResult = await requestRoute(points, 'bicycle', { ...opts, costingOptions: bicycleCostingOptions })

  if (!pedestrianFallback) {
    return bicycleResult ? pick(bicycleResult) : { coords: points, turns: [], kinds: null }
  }

  const pedestrianResult = await requestRoute(points, 'pedestrian', opts)

  if (bicycleResult && pedestrianResult) {
    const snapDiff = bicycleResult.snapDistance - pedestrianResult.snapDistance
    if (Math.abs(snapDiff) > SNAP_DISTANCE_THRESHOLD_M) {
      return snapDiff > 0 ? pick(pedestrianResult) : pick(bicycleResult)
    }
    return routeLength(pedestrianResult.coords) < routeLength(bicycleResult.coords)
      ? pick(pedestrianResult)
      : pick(bicycleResult)
  }
  const chosen = bicycleResult ?? pedestrianResult
  return chosen ? pick(chosen) : { coords: points, turns: [], kinds: null }
}

function pick(result) {
  return { coords: result.coords, turns: result.turns, kinds: result.kinds }
}
