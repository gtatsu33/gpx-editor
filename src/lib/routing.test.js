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
    expect(result.coords).toEqual([[35.0, 139.0], [35.001, 139.001]])
    expect(result.turns).toEqual([])
  })

  it('APIがcode!=="Ok"を返したら入力をそのまま返す（フォールバック）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }))
    const input = [[35.0, 139.0], [35.001, 139.001]]
    const result = await calcRouteSegment(input, { fetchImpl, ...noWaitOpts })
    expect(result.coords).toBe(input)
    expect(result.turns).toEqual([])
  })

  it('HTTPエラー時は入力をそのまま返す（フォールバック）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }))
    const input = [[35.0, 139.0], [35.001, 139.001]]
    const result = await calcRouteSegment(input, { fetchImpl, ...noWaitOpts })
    expect(result.coords).toBe(input)
  })

  it('ネットワークエラー・タイムアウト時は入力をそのまま返す（フォールバック）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'))
    const input = [[35.0, 139.0], [35.001, 139.001]]
    const result = await calcRouteSegment(input, { fetchImpl, ...noWaitOpts })
    expect(result.coords).toBe(input)
  })

  it('前回呼び出しから1秒未満の場合は残り時間だけ待機してから送信する', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }))
    const sleep = vi.fn().mockResolvedValue(undefined)
    let t = 1_000_000
    const now = () => t

    await calcRouteSegment([[35.0, 139.0]], { fetchImpl, sleep, now, pedestrianFallback: false })
    t += 200 // 200ms後に2回目を呼ぶ
    await calcRouteSegment([[35.0, 139.0]], { fetchImpl, sleep, now, pedestrianFallback: false })

    expect(sleep).toHaveBeenLastCalledWith(800)
  })

  // spec.txt 9章（2026-09-27追加）: 「歩道もルート候補に含める」トグルOFF
  // （pedestrianFallback: false）の場合、bicycle costingにuse_roads: 1を
  // 指定して車道を強く優先させる。トグルON（既定）では何も指定しない
  // （既存動作を変えない）。
  describe('use_roadsの調整（2026-09-27追加）', () => {
    function bodyOf(fetchImpl, callIndex = 0) {
      return JSON.parse(fetchImpl.mock.calls[callIndex][1].body)
    }

    it('pedestrianFallback: falseの場合、bicycle costingにuse_roads: 1を指定する', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }))
      await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts, pedestrianFallback: false })
      expect(bodyOf(fetchImpl).costing_options).toEqual({ bicycle: { use_roads: 1 } })
    })

    it('pedestrianFallback: true（既定）の場合、costing_optionsを指定しない', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }))
      await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts })
      expect(bodyOf(fetchImpl).costing_options).toBeUndefined()
    })
  })

  // spec.txt 9章・11章（2026-09-27追加）: 応答のlegs[].stepsからターン候補を
  // 同時に抽出する（案A）。
  describe('turns抽出（2026-09-27追加）', () => {
    it('応答のmaneuverからturnsを抽出する（depart/arrive除外、junction_nameの多言語連結は先頭のみ採用）', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          code: 'Ok',
          routes: [
            {
              geometry: { coordinates: [[139.0, 35.0], [139.001, 35.001], [139.002, 35.002], [139.003, 35.003]] },
              legs: [
                {
                  steps: [
                    { maneuver: { type: 'depart', bearing_before: 0, bearing_after: 10 }, intersections: [{ geometry_index: 0 }] },
                    {
                      maneuver: { type: 'turn', bearing_before: 10, bearing_after: 280 },
                      intersections: [{ geometry_index: 1 }],
                      junction_name: '神宮前六丁目, Jingumae 6',
                    },
                    {
                      maneuver: { type: 'continue', bearing_before: 280, bearing_after: 290 },
                      intersections: [{ geometry_index: 2 }],
                    },
                    { maneuver: { type: 'arrive', bearing_before: 290, bearing_after: 290 }, intersections: [{ geometry_index: 3 }] },
                  ],
                },
              ],
            },
          ],
        })
      )
      const result = await calcRouteSegment(
        [[35.0, 139.0], [35.003, 139.003]],
        { fetchImpl, ...noWaitOpts, pedestrianFallback: false }
      )
      // depart/arriveは除外、continueは|delta|<45で除外、turnのみ残る
      expect(result.turns).toEqual([{ index: 1, delta: -90, name: '神宮前六丁目' }])
    })
  })

  describe('pedestrianFallback（2026-09-21追加）', () => {
    it('デフォルトでbicycleとpedestrianの両方を計算し、距離が短い方を採用する', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(
          jsonResponse({
            code: 'Ok',
            // 大きく迂回する自転車ルート
            routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.05, 35.05], [139.001, 35.001]] } }],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: 'Ok',
            // 短い歩道経由の歩行者ルート
            routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.001, 35.001]] } }],
          })
        )
      const result = await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts })
      expect(result.coords).toEqual([[35.0, 139.0], [35.001, 139.001]])
    })

    it('pedestrianFallback: falseの場合はbicycleの結果のみを使う（pedestrianを呼ばない）', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          code: 'Ok',
          routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.001, 35.001]] } }],
        })
      )
      await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts, pedestrianFallback: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('bicycleが失敗しpedestrianが成功した場合はpedestrianの結果を使う', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ code: 'NoRoute' }))
        .mockResolvedValueOnce(
          jsonResponse({
            code: 'Ok',
            routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.001, 35.001]] } }],
          })
        )
      const result = await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts })
      expect(result.coords).toEqual([[35.0, 139.0], [35.001, 139.001]])
    })

    it('両方失敗した場合は入力をそのまま返す', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute' }))
      const input = [[35.0, 139.0], [35.001, 139.001]]
      const result = await calcRouteSegment(input, { fetchImpl, ...noWaitOpts })
      expect(result.coords).toBe(input)
    })
  })

  describe('スナップ距離による判定（2026-09-21追加）', () => {
    it('スナップ距離差が閾値(3m)を超える場合は、総距離に関わらずスナップ距離が小さい方を採用する', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(
          jsonResponse({
            code: 'Ok',
            // bicycleは総距離は短いが、歩道から6.2m離れた車道にスナップされている
            routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.0005, 35.0005]] } }],
            waypoints: [{ distance: 0 }, { distance: 6.2 }],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: 'Ok',
            // pedestrianは総距離は長いが、指定地点にほぼ正確にスナップされている
            routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.001, 35.001]] } }],
            waypoints: [{ distance: 0 }, { distance: 0.1 }],
          })
        )
      const result = await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts })
      expect(result.coords).toEqual([[35.0, 139.0], [35.001, 139.001]])
    })

    it('スナップ距離差が閾値(3m)以内の場合は、経路の総距離が短い方を採用する', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(
          jsonResponse({
            code: 'Ok',
            // bicycleは大きく迂回するが、スナップ自体は正確
            routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.05, 35.05], [139.001, 35.001]] } }],
            waypoints: [{ distance: 0 }, { distance: 1 }],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: 'Ok',
            routes: [{ geometry: { coordinates: [[139.0, 35.0], [139.001, 35.001]] } }],
            waypoints: [{ distance: 0 }, { distance: 2 }],
          })
        )
      const result = await calcRouteSegment([[35.0, 139.0], [35.001, 139.001]], { fetchImpl, ...noWaitOpts })
      expect(result.coords).toEqual([[35.0, 139.0], [35.001, 139.001]])
    })
  })
})
