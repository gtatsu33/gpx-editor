import { describe, expect, it } from 'vitest'
import { interpolateStructureElevations, structureRuns } from './structures.js'

// 緯度方向に約22m間隔の直線上の点列
const line = (n) => Array.from({ length: n }, (_, i) => [35 + i * 0.0002, 139])

describe('structureRuns', () => {
  it('2以上が3点以上連続する範囲だけを返す', () => {
    expect(structureRuns([1, 2, 2, 2, 1, 2, 2, 1, 3, 3, 3])).toEqual([
      { from: 1, to: 3 },
      { from: 8, to: 10 },
    ])
  })
  it('0と1は対象外', () => {
    expect(structureRuns([0, 1, 0, 1])).toEqual([])
  })
})

describe('interpolateStructureElevations', () => {
  it('出入口を結ぶ直線で内部を置き換え、出入口は変えない', () => {
    const out = interpolateStructureElevations(line(5), [10, 200, 300, 250, 20], [1, 2, 2, 2, 2])
    expect(out).toEqual([10, 200, 300, 250, 20].map((v, i) => (i >= 2 && i <= 3 ? out[i] : v)))
    expect(out[1]).toBe(200)
    expect(out[2]).toBeCloseTo(200 + (20 - 200) * (1 / 3), 0)
    expect(out[4]).toBe(20)
  })
  it('出入口の標高が無ければ変更しない', () => {
    const ele = [null, 5, 6, 7]
    expect(interpolateStructureElevations(line(4), ele, [2, 2, 2, 2])).toEqual(ele)
  })
  it('冪等（再実行しても同じ）', () => {
    const once = interpolateStructureElevations(line(5), [100, 300, 400, 300, 160], [2, 2, 2, 2, 2])
    expect(interpolateStructureElevations(line(5), once, [2, 2, 2, 2, 2])).toEqual(once)
  })
})
