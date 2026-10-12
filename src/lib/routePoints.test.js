import { describe, expect, it } from 'vitest'
import { contiguousRanges, deepCopyRoutePoints, makeRoutePoint, nextBoundary, prevBoundary, shouldRoute, splitByCorrected } from './routePoints.js'

describe('routePoints.js', () => {
  it('makeRoutePointがデフォルト値を持つ', () => {
    expect(makeRoutePoint(35, 139)).toEqual({
      lat: 35,
      lon: 139,
      eleOrg: null,
      eleFix: null,
      isAcpt: false,
      wpt: null,
      changed: true,
      useRouting: true,
      eleStructure: 0,
    })
  })

  it('shouldRouteが両端のuse_routingが共にtrueの場合のみtrueを返す', () => {
    const on = { useRouting: true }
    const off = { useRouting: false }
    expect(shouldRoute(on, on)).toBe(true)
    expect(shouldRoute(on, off)).toBe(false)
    expect(shouldRoute(off, on)).toBe(false)
    expect(shouldRoute(off, off)).toBe(false)
  })

  it('deepCopyRoutePointsがwptも含めて独立コピーする', () => {
    const rp = [makeRoutePoint(35, 139, { wpt: { name: 'a', delta: 1 } })]
    const copy = deepCopyRoutePoints(rp)
    copy[0].wpt.name = 'changed'
    expect(rp[0].wpt.name).toBe('a')
  })

  it('prevBoundary/nextBoundaryがacptまたはwptの境界を返す', () => {
    const rp = [
      makeRoutePoint(0, 0, { isAcpt: true, wpt: { name: 'スタート', delta: null } }),
      makeRoutePoint(0, 1),
      makeRoutePoint(0, 2, { isAcpt: true }),
      makeRoutePoint(0, 3),
      makeRoutePoint(0, 4, { isAcpt: true, wpt: { name: '目的地', delta: null } }),
    ]
    expect(prevBoundary(3, rp)).toBe(2)
    expect(nextBoundary(1, rp)).toBe(2)
    expect(prevBoundary(1, rp)).toBe(0)
    expect(nextBoundary(3, rp)).toBe(4)
  })

  it('contiguousRangesが連続インデックスをまとめる', () => {
    expect(contiguousRanges([1, 2, 3, 5, 6, 9])).toEqual([
      [1, 3],
      [5, 6],
      [9, 9],
    ])
    expect(contiguousRanges([])).toEqual([])
  })

  describe('splitByCorrected', () => {
    const rp = (kinds) => kinds.map((k) => ({ eleStructure: k }))

    it('トンネル・橋の点が無ければ区間全体を1つの通常区間にする', () => {
      expect(splitByCorrected(rp([0, 1, 1, 0]), 0, 3)).toEqual([{ from: 0, to: 3, corrected: false }])
    })

    it('2以上が連続する範囲を、出入口の点から出入口の点までの補正区間にする', () => {
      const r = splitByCorrected(rp([1, 1, 2, 2, 2, 1, 1]), 0, 6)
      expect(r).toEqual([
        { from: 0, to: 2, corrected: false },
        { from: 2, to: 4, corrected: true },
        { from: 4, to: 6, corrected: false },
      ])
    })

    it('橋(3)もトンネル(2)と同様に扱う', () => {
      const r = splitByCorrected(rp([1, 3, 3, 1]), 0, 3)
      expect(r.filter((x) => x.corrected)).toEqual([{ from: 1, to: 2, corrected: true }])
    })

    it('孤立した1点は線にならないので補正区間にしない', () => {
      expect(splitByCorrected(rp([1, 2, 1]), 0, 2)).toEqual([{ from: 0, to: 2, corrected: false }])
    })

    it('区間が複数あれば、それぞれ別区間にし、全体を隙間なく覆う', () => {
      const r = splitByCorrected(rp([1, 2, 2, 1, 2, 2, 2, 1]), 0, 7)
      expect(r.filter((x) => x.corrected)).toEqual([
        { from: 1, to: 2, corrected: true },
        { from: 4, to: 6, corrected: true },
      ])
      for (let i = 1; i < r.length; i++) expect(r[i].from).toBe(r[i - 1].to)
      expect(r[0].from).toBe(0)
      expect(r[r.length - 1].to).toBe(7)
    })
  })
})
