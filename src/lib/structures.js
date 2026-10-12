import { cumulativeDistances } from './elevation.js'

/**
 * トンネル区間の標高補正（spec.txt 13-5章）。
 * 構造種別 kinds[i]: 0=未検証 / 1=地表 / 2=トンネル / 3=橋。
 * 2または3が連続する範囲（出入口を含む）の内部の国土地理院標高（ele_fix）を、
 * 出入口の標高から距離比例で直線補間して置き換える。出入口自体の標高は変えない。
 * 国土地理院の標高APIは地表面標高を返すため、トンネルでは山頂、橋では谷底の標高になる。
 */
export const MIN_RUN_POINTS = 3 // 出入口2点＋内部1点以上

/** kindsが2以上の連続範囲を [{from, to}]（両端含む、MIN_RUN_POINTS以上）で返す。 */
export function structureRuns(kinds) {
  const runs = []
  let i = 0
  while (i < kinds.length) {
    if (!(kinds[i] >= 2)) {
      i += 1
      continue
    }
    let j = i
    while (j + 1 < kinds.length && kinds[j + 1] >= 2) j += 1
    if (j - i + 1 >= MIN_RUN_POINTS) runs.push({ from: i, to: j })
    i = j + 1
  }
  return runs
}

/**
 * points: [[lat,lon],...]、eleFix: 国土地理院標高（nullあり）、kinds: 構造種別。
 * 戻り値: 補間後のeleFix（新しい配列）。出入口の標高が未取得（null）の範囲は変更しない。
 * 同じ入力に対して結果は同じ（再実行しても値が変わらない）。
 */
export function interpolateStructureElevations(points, eleFix, kinds) {
  const out = [...eleFix]
  const runs = structureRuns(kinds)
  if (!runs.length) return out
  const cum = cumulativeDistances(points)
  runs.forEach(({ from, to }) => {
    const ea = eleFix[from]
    const eb = eleFix[to]
    const total = cum[to] - cum[from]
    if (ea === null || ea === undefined || eb === null || eb === undefined || total <= 0) return
    for (let i = from + 1; i < to; i++) {
      out[i] = Math.round((ea + ((eb - ea) * (cum[i] - cum[from])) / total) * 10) / 10
    }
  })
  return out
}
