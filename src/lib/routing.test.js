import { describe, expect, it, vi } from 'vitest'
import { calcRouteSegment } from './routing.js'

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

// 実タイマーのfair-useスロットリング（1req/秒）待機がテストを遅くしない
// ようにするno-op sleep（待機時間に関わらず即座にresolveする）。
const noWaitOpts = { sleep: vi.fn().mockResolvedValue(undefined) }

describe('routing.js calcRouteSegment', () => {
  it('正常系: GeoJSON座標を[lat,lon]に変換して返す', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 'Ok',
        routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.001, 35.001]] } }],
      })
    )
    const result = await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts })
    expect(result).toEqual([[35.0, 139.0], [35.001, 139.001]])
  })

  it('APIがcode!=="Ok"を返したら入力をそのまま返す（フォールバック）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }))
    const input = [[35.0, 139.0], [35.001, 139.001]]
    const result = await calcRouteSegment(input, { fetchImpl, ...noWaitOpts })
    expect(result).toBe(input)
  })

  it('HTTPエラー時は入力をそのまま返す（フォールバック）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }))
    const input = [[35.0, 139.0], [35.001, 139.001]]
    const result = await calcRouteSegment(input, { fetchImpl, ...noWaitOpts })
    expect(result).toBe(input)
  })

  it('ネットワークエラー・タイムアウト時は入力をそのまま返す（フォールバック）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'))
    const input = [[35.0, 139.0], [35.001, 139.001]]
    const result = await calcRouteSegment(input, { fetchImpl, ...noWaitOpts })
    expect(result).toBe(input)
  })

  it('前回呼び出しから1秒未満の場合は残り時間だけ待機してから送信する', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }))
    const sleep = vi.fn().mockResolvedValue(undefined)
    let t = 1_000_000
    const now = () => t

    await calcRouteSegment([[35.0, 139.0]], { fetchImpl, sleep, now })
    t += 200 // 200ms後に2回目を呼ぶ
    await calcRouteSegment([[35.0, 139.0]], { fetchImpl, sleep, now })

    expect(sleep).toHaveBeenLastCalledWith(800)
  })
})
