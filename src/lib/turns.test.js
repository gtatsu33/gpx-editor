import { describe, expect, it } from 'vitest'
import { applyRoutedTurns, detectTurns, extractTurnsFromSteps, turnLabel } from './turns.js'
import { makeRoutePoint } from './routePoints.js'
import fixture from '../__fixtures__/turns.json'

describe('turns.js (Python版 gpxconverter.py との突き合わせ)', () => {
  it('detectTurnsがPython版と一致する', () => {
    const { points, min_turn_angle: minTurnAngle, min_dist: minDist, smooth } = fixture.detectTurns.input
    const result = detectTurns(points, { minTurnAngle, minDist, smooth })
    expect(result.length).toBe(fixture.detectTurns.output.length)
    result.forEach((r, i) => {
      const expected = fixture.detectTurns.output[i]
      expect(r.index).toBe(expected.index)
      expect(r.lat).toBeCloseTo(expected.lat, 9)
      expect(r.lon).toBeCloseTo(expected.lon, 9)
      expect(r.delta).toBeCloseTo(expected.delta, 6)
    })
  })

  it.each(fixture.turnLabel)('turnLabel %#', (c) => {
    expect(turnLabel(c.input)).toEqual(c.output)
  })
})

// spec.txt 9章・11章（2026-09-27追加）: ルーティングAPI応答のmaneuverから
// ターン候補を抽出する方式（案A）。
describe('extractTurnsFromSteps', () => {
  function step(overrides) {
    return {
      maneuver: { type: 'turn', bearing_before: 0, bearing_after: 90 },
      intersections: [{ geometry_index: 0 }],
      ...overrides,
    }
  }

  it('depart/arriveは除外する', () => {
    const steps = [
      step({ maneuver: { type: 'depart', bearing_before: 0, bearing_after: 90 }, intersections: [{ geometry_index: 0 }] }),
      step({ intersections: [{ geometry_index: 5 }] }),
      step({ maneuver: { type: 'arrive', bearing_before: 0, bearing_after: 90 }, intersections: [{ geometry_index: 9 }] }),
    ]
    const result = extractTurnsFromSteps(steps)
    expect(result).toEqual([{ index: 5, delta: 90, name: null }])
  })

  it('|delta| < minTurnAngle（既定45度）の候補は除外する', () => {
    const steps = [
      step({ maneuver: { type: 'continue', bearing_before: 0, bearing_after: 20 }, intersections: [{ geometry_index: 3 }] }),
    ]
    expect(extractTurnsFromSteps(steps)).toEqual([])
  })

  it('junction_nameの多言語連結（"現地語, 英語"）から先頭のみ取り出す', () => {
    const steps = [step({ intersections: [{ geometry_index: 2 }], junction_name: '神宮前六丁目, Jingumae 6' })]
    expect(extractTurnsFromSteps(steps)).toEqual([{ index: 2, delta: 90, name: '神宮前六丁目' }])
  })

  it('junction_nameが無い場合はnameがnullになる', () => {
    const steps = [step({ intersections: [{ geometry_index: 2 }] })]
    expect(extractTurnsFromSteps(steps)[0].name).toBeNull()
  })

  it('intersections[0].geometry_indexが無ければ除外する', () => {
    const steps = [step({ intersections: [] })]
    expect(extractTurnsFromSteps(steps)).toEqual([])
  })
})

describe('applyRoutedTurns', () => {
  function pts(n) {
    return Array.from({ length: n }, (_, i) => makeRoutePoint(35 + i, 139, { changed: true }))
  }

  it('junction_name有りは確定名（pending:false）で即時反映し、changedをfalseにする', () => {
    const points = pts(3)
    applyRoutedTurns(points, [{ index: 1, delta: -70, name: '神宮前六丁目' }], 0)
    expect(points[1]).toMatchObject({ wpt: { name: '神宮前六丁目を左折', delta: -70, pending: false }, changed: false })
    expect(points[0].changed).toBe(true)
    expect(points[2].changed).toBe(true)
  })

  it('junction_name無しはプレースホルダ名＋pending:trueにする', () => {
    const points = pts(3)
    applyRoutedTurns(points, [{ index: 1, delta: 80, name: null }], 0)
    expect(points[1]).toMatchObject({ wpt: { name: '右折', delta: 80, pending: true }, changed: false })
  })

  it('offsetでturns[].indexをpoints配列内の相対位置に補正する', () => {
    const points = pts(2)
    applyRoutedTurns(points, [{ index: 3, delta: 90, name: null }], 2)
    expect(points[1].wpt).not.toBeNull()
  })

  it('offset補正後にpoints配列の範囲外になる候補は無視する', () => {
    const points = pts(2)
    applyRoutedTurns(points, [{ index: 10, delta: 90, name: null }], 0)
    expect(points.every((p) => p.wpt === null)).toBe(true)
  })
})
