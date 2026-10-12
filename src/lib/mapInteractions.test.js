import { describe, expect, it } from 'vitest'
import {
  clusterCandidates,
  directionArrowPositions,
  nearAllWithinThreshold,
  nearestIndexAtDistance,
  nearestPoint,
  pxToMeters,
} from './mapInteractions.js'

describe('mapInteractions.js', () => {
  it('pxToMetersは緯度・ズームに応じて実距離に換算する', () => {
    expect(pxToMeters(20, 13, 35)).toBeGreaterThan(0)
    expect(pxToMeters(20, 18, 35)).toBeLessThan(pxToMeters(20, 13, 35))
  })

  it('nearestPointが最も近い点を返す', () => {
    const points = [
      [35.0, 139.0],
      [35.001, 139.0],
      [35.01, 139.0],
    ]
    expect(nearestPoint(points, 35.0009, 139.0).idx).toBe(1)
  })

  it('nearAllWithinThresholdが閾値内の候補を全て返す', () => {
    const points = [
      [35.0, 139.0],
      [35.0005, 139.0],
      [35.01, 139.0],
    ]
    const result = nearAllWithinThreshold(points, 35.0, 139.0, 100)
    expect(result.map((r) => r.idx)).toEqual([0, 1])
  })

  it('nearestIndexAtDistanceが最も距離の近いインデックスを返す', () => {
    expect(nearestIndexAtDistance([0, 100, 250, 400], 260)).toBe(2)
    expect(nearestIndexAtDistance([0, 100, 250, 400], 0)).toBe(0)
  })

  it('clusterCandidatesがルート距離200m以内をまとめ、各クラスタの最近傍を代表にする', () => {
    const candidates = [
      { idx: 0, dist: 5 },
      { idx: 1, dist: 1 },
      { idx: 5, dist: 3 },
    ]
    const cumDists = [0, 50, 100, 150, 200, 900]
    const reps = clusterCandidates(candidates, cumDists, 200)
    expect(reps).toEqual([
      { idx: 1, dist: 1 },
      { idx: 5, dist: 3 },
    ])
  })
})

describe('directionArrowPositions', () => {
  // 北へ一直線、1点が約1.11km（0.01°）
  const pts = Array.from({ length: 13 }, (_, i) => [35 + i * 0.01, 139])
  const cum = pts.map((_, i) => i * 1112)

  it('5kmごとに最寄りのtrkptへ、進行方向（北=0度）で置く', () => {
    const r = directionArrowPositions(pts, cum, 5)
    expect(r.map((a) => a.index)).toEqual([4, 9])
    r.forEach((a) => expect(a.deg).toBeCloseTo(0, 0))
  })
  it('ルート全体が間隔未満なら空', () => {
    expect(directionArrowPositions(pts.slice(0, 4), cum.slice(0, 4), 5)).toEqual([])
  })
  it('点が1つ以下なら空', () => {
    expect(directionArrowPositions([[35, 139]], [0], 5)).toEqual([])
  })
})
