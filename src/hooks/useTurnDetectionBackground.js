import { useEffect, useRef, useState } from 'react'
import { combineTurnName, detectTurns } from '../lib/turns.js'
import { contiguousRanges } from '../lib/routePoints.js'
import { fetchIntersectionNames } from '../lib/overpass.js'

const DEBOUNCE_MS = 800
const NAME_BATCH_SIZE = 10
const DETECT_OPTIONS = { minTurnAngle: 45, minDist: 100, smooth: 1 }

function coordKey(lat, lon) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

/** changed=trueな区間から、今後拾われるはずの候補数を数える（進捗表示の見積り用）。 */
function countWaitingCandidates(rp) {
  const changedIdx = rp.map((p, i) => (p.changed ? i : null)).filter((i) => i !== null)
  if (!changedIdx.length) return 0
  let count = 0
  for (const [rstart, rend] of contiguousRanges(changedIdx)) {
    const sub = rp.slice(rstart, rend + 1).map((p) => [p.lat, p.lon])
    count += detectTurns(sub, DETECT_OPTIONS).length
  }
  return count
}

/** 現在の残りチャンク数を見積もる（pending中の点＋まだ角度検出も済んでいない待機中候補）。 */
function estimateChunksRemaining(rp) {
  const pendingCount = rp.filter((p) => p.wpt && p.wpt.pending).length
  return Math.ceil(pendingCount / NAME_BATCH_SIZE) + Math.ceil(countWaitingCandidates(rp) / NAME_BATCH_SIZE)
}

/**
 * ターンポイントの自動バックグラウンド検出。implement.txt。
 * ルート編集（changed=trueな区間の発生）に追従し、明示的な開始操作なしで自動的に
 * 角度検出→交差点名取得を行う。
 *
 * 角度検出（Step A・同期・高速）とOverpassでの交差点名取得（Step B・非同期・低速）は
 * 独立したロックで動く。Step Bのフェッチが進行中でも、その間に発生した新しい編集の
 * Step Aは即座に実行されwpt.pending=trueの仮状態が地図・一覧に反映される
 * （以前の実装ではStep Bの完了までStep Aごとブロックされてしまっていたバグを修正）。
 * Step Bはpendingが無くなるまで回り続けるループとし、ループ中に増えたpendingも
 * 同じループ内で拾う。
 */
export function useTurnDetectionBackground(routePoints, dispatch) {
  const [status, setStatus] = useState({ state: 'idle', chunksRemaining: 0 })

  const routePointsRef = useRef(routePoints)
  routePointsRef.current = routePoints
  const debounceTimerRef = useRef(null)
  const fetchRunningRef = useRef(false)

  function runAngleDetection() {
    const rp = routePointsRef.current
    const changedIdx = rp.map((p, i) => (p.changed ? i : null)).filter((i) => i !== null)
    if (!changedIdx.length) return
    const assignments = []
    for (const [rstart, rend] of contiguousRanges(changedIdx)) {
      const sub = rp.slice(rstart, rend + 1).map((p) => [p.lat, p.lon])
      detectTurns(sub, DETECT_OPTIONS).forEach((t) => assignments.push({ trkptIndex: rstart + t.index, delta: t.delta }))
    }
    dispatch({ type: 'APPLY_TURN_CANDIDATES', payload: { assignments } })
  }

  async function runNameFetchLoop() {
    if (fetchRunningRef.current) return
    fetchRunningRef.current = true
    // dispatch直後はまだ再レンダリングが済んでおらずroutePointsRefが更新されて
    // いないため、直前の周回で処理済みの点をここに記録し、routePointsRef側の
    // 反映を待たずに二重フェッチを防ぐ（座標ベース。インデックスはルート編集で
    // ずれ得るため使わない）
    const handledKeys = new Set()

    while (true) {
      const rp = routePointsRef.current
      const pendingIdx = rp
        .map((p, i) => (p.wpt && p.wpt.pending && !handledKeys.has(coordKey(p.lat, p.lon)) ? i : null))
        .filter((i) => i !== null)
      if (!pendingIdx.length) break

      const chunkIdx = pendingIdx.slice(0, NAME_BATCH_SIZE)

      // Overpassは候補をまとめて1リクエストで問い合わせるため、進捗は1件単位
      // ではなくチャンク単位（最大10件/チャンク）でしか追えない。
      setStatus({ state: 'running', chunksRemaining: estimateChunksRemaining(rp) })

      const turns = chunkIdx.map((idx) => ({ lat: rp[idx].lat, lon: rp[idx].lon, index: idx, delta: rp[idx].wpt.delta }))
      chunkIdx.forEach((idx) => handledKeys.add(coordKey(rp[idx].lat, rp[idx].lon)))
      const inames = await fetchIntersectionNames(turns)

      // ルート編集でインデックスがずれた点には書き込まない（取得開始時と座標が
      // 一致する点のみ反映。ずれた点はpendingのままなので次の周回で改めて拾われる）
      const curRp = routePointsRef.current
      const assignments = turns
        .filter((t) => curRp[t.index] && curRp[t.index].lat === t.lat && curRp[t.index].lon === t.lon)
        .map((t) => ({ trkptIndex: t.index, name: combineTurnName(t.delta, inames[t.index] ?? null) }))
      if (assignments.length) {
        dispatch({ type: 'SET_TURN_NAME_BATCH', payload: { assignments } })
      }
    }

    fetchRunningRef.current = false
    setStatus({ state: 'idle', chunksRemaining: 0 })
  }

  useEffect(() => {
    if (!routePoints.length) return undefined
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      runAngleDetection()
      runNameFetchLoop()
    }, DEBOUNCE_MS)
    return () => clearTimeout(debounceTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePoints])

  // フェッチ実行中に新たな編集でpending/待機中候補が増減した場合、ループの
  // 次の周回（現在のOverpass往復が終わるまで）を待たず、即座に表示へ反映する
  useEffect(() => {
    if (!fetchRunningRef.current) return
    setStatus({ state: 'running', chunksRemaining: estimateChunksRemaining(routePoints) })
  }, [routePoints])

  return { status }
}
