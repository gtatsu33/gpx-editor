/**
 * spec.txt 5-1章のRoutePoint構造を生成する。
 * eleStructure: 構造種別（13-5章）。0=未検証 / 1=地表 / 2=トンネル / 3=橋。
 * 2・3の連続区間は標高を補間で補正し、地図上で赤く描く（GPXには保存しない）。
 */
export function makeRoutePoint(
  lat,
  lon,
  { eleOrg = null, eleFix = null, isAcpt = false, wpt = null, changed = true, useRouting = true, eleStructure = 0 } = {}
) {
  return { lat, lon, eleOrg, eleFix, isAcpt, wpt, changed, useRouting, eleStructure }
}

/**
 * rp[s]〜rp[e]（両端含む）の区間を、トンネル・橋（eleStructureが2以上）の点が連続する
 * 範囲とそれ以外に分割する。spec.txt 7-1章・13-5章。トンネル区間は出入口の点から
 * 出入口の点まで（2点以上連続する範囲）。
 * 戻り値: [{ from, to, corrected }]（隣り合う区間は端点を共有する）
 */
export function splitByCorrected(rp, s, e) {
  const out = []
  let cur = s
  let i = s
  while (i <= e) {
    if (!(rp[i].eleStructure >= 2)) {
      i += 1
      continue
    }
    let j = i
    while (j + 1 <= e && rp[j + 1].eleStructure >= 2) j += 1
    if (j > i) {
      if (i > cur) out.push({ from: cur, to: i, corrected: false })
      out.push({ from: i, to: j, corrected: true })
      cur = j
    }
    i = j + 1
  }
  if (cur < e || out.length === 0) out.push({ from: cur, to: e, corrected: false })
  return out
}

/**
 * 2点間の区間を「ルート検索する」か「直線で結ぶ」か。spec.txt 5-2章
 * （2026-09-13追加）: 両端のuse_routingが共にtrueの場合のみルート検索する。
 */
export function shouldRoute(a, b) {
  return a.useRouting !== false && b.useRouting !== false
}

export function deepCopyRoutePoints(rp) {
  return rp.map((p) => ({ ...p, wpt: p.wpt ? { ...p.wpt } : null }))
}

/** idxより前にあるis_acptまたはwptのうち最大のindexを返す。spec.txt 5-2/8-2章。 */
export function prevBoundary(idx, rp) {
  let result = 0
  for (let i = 0; i < idx; i++) {
    if (rp[i].isAcpt || rp[i].wpt !== null) result = i
  }
  return result
}

/** idxより後にあるis_acptまたはwptのうち最小のindexを返す。 */
export function nextBoundary(idx, rp) {
  for (let i = idx + 1; i < rp.length; i++) {
    if (rp[i].isAcpt || rp[i].wpt !== null) return i
  }
  return rp.length - 1
}

/** 連続するインデックスをまとめて [start, end] タプルのリストにする。spec.txt 15章。 */
export function contiguousRanges(indices) {
  if (!indices.length) return []
  const ranges = []
  let start = indices[0]
  let end = indices[0]
  for (let k = 1; k < indices.length; k++) {
    const i = indices[k]
    if (i === end + 1) {
      end = i
    } else {
      ranges.push([start, end])
      start = i
      end = i
    }
  }
  ranges.push([start, end])
  return ranges
}
