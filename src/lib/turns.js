import { angleDiff, calculateBearing, haversine } from './geo.js'

/**
 * 角度法によるターン検出。points は [[lat, lon], ...] 形式。
 * spec.txt 11章のアルゴリズムに対応。
 */
export function detectTurns(points, { minTurnAngle = 45, minDist = 100, smooth = 1 } = {}) {
  const n = points.length
  const candidates = []
  for (let i = smooth; i < n - smooth; i++) {
    const A = points[i - smooth]
    const X = points[i]
    const B = points[i + smooth]
    const bearingIn = calculateBearing(A[0], A[1], X[0], X[1])
    const bearingOut = calculateBearing(X[0], X[1], B[0], B[1])
    const turn = angleDiff(bearingIn, bearingOut)
    if (Math.abs(turn) >= minTurnAngle) {
      candidates.push({ lat: X[0], lon: X[1], delta: turn, index: i })
    }
  }

  if (!candidates.length) return []

  const sorted = [...candidates].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const used = new Set()
  const turns = []
  for (const c of sorted) {
    if (used.has(c.index)) continue
    turns.push(c)
    for (const c2 of candidates) {
      if (haversine(c.lat, c.lon, c2.lat, c2.lon) < minDist) {
        used.add(c2.index)
      }
    }
  }

  turns.sort((a, b) => a.index - b.index)
  return turns
}

/** delta（度）から [ラベル, 矢印, 色] を返す。spec.txt 11章末尾。 */
export function turnLabel(delta) {
  if (delta >= 60) return ['右折', '⇒', '#e74c3c']
  if (delta >= 25) return ['やや右', '↗', '#e67e22']
  if (delta <= -60) return ['左折', '⇐', '#2980b9']
  if (delta <= -25) return ['やや左', '↖', '#8e44ad']
  return ['直進維持', '↑', '#7f8c8d']
}

/** delta＋交差点名から最終的な案内名を組み立てる。spec.txt 8-5章 with_name()相当。 */
export function combineTurnName(delta, intersectionName) {
  return intersectionName ? `${intersectionName}を${turnLabel(delta)[0]}` : turnLabel(delta)[0]
}

/** wpt情報から [矢印, 色] を返す。spec.txt 7-1章（中間wptマーカーの色）。 */
export function wptStyle(wpt) {
  if (wpt && wpt.delta !== null && wpt.delta !== undefined) {
    const [, arrow, color] = turnLabel(wpt.delta)
    return [arrow, color]
  }
  return ['📍', '#27ae60']
}

/**
 * "渋谷駅前, Shibuya Scramble Crossing" のような多言語連結名から、
 * 先頭（現地語）の名前だけを取り出す。取れなければnull。
 */
function primaryLocalName(raw) {
  if (!raw) return null
  const first = raw.split(/[,;]/)[0].trim()
  return first || null
}

/**
 * ルーティングAPI（OSRM互換形式）のsteps配列からターン候補を抽出する。
 * spec.txt 9章・11章（2026-09-27改訂）。maneuverのbearing_before/after
 * （APIが既に計算済みの値）をそのまま使い、幾何再計算は行わない。
 * depart/arriveは除外し、|delta| < minTurnAngle の候補も除外する
 * （detectTurnsのminDist重複排除は不要。ルーティングAPIのmaneuverは
 * 既に1決定点1件に統合されているため）。
 * index は呼び出し側が渡したcoords配列（両端点を含む）に対応する絶対インデックス。
 */
export function extractTurnsFromSteps(steps, { minTurnAngle = 45 } = {}) {
  const turns = []
  steps.forEach((step) => {
    const m = step.maneuver
    if (!m || m.type === 'depart' || m.type === 'arrive') return
    const delta = angleDiff(m.bearing_before, m.bearing_after)
    if (Math.abs(delta) < minTurnAngle) return
    const index = step.intersections?.[0]?.geometry_index
    if (index === undefined || index === null) return
    turns.push({ index, delta, name: primaryLocalName(step.junction_name) })
  })
  return turns
}

/**
 * extractTurnsFromStepsで得たturnsを、生成済みのRoutePoint配列（points、
 * 破壊的に更新）に適用する。offsetは元のcoords配列に対するpoints[0]の
 * 絶対インデックス（呼び出し側がcoords配列の一部をslice(1)やslice(1,-1)
 * して使っているため）。junction_nameが取れていればpending:falseで確定名を、
 * 取れていなければプレースホルダ名＋pending:trueを設定し、既存のOverpass
 * バックグラウンド取得（useTurnDetectionBackground）に処理を委ねる。
 * 適用した点はchanged:falseにする（幾何法による再検出対象から外す）。
 */
export function applyRoutedTurns(points, turns, offset) {
  turns.forEach((t) => {
    const i = t.index - offset
    if (i < 0 || i >= points.length) return
    points[i] = {
      ...points[i],
      wpt: { name: combineTurnName(t.delta, t.name), delta: t.delta, pending: !t.name },
      changed: false,
    }
  })
  return points
}
