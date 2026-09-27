import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { calculateBearing } from '../lib/geo.js'
import { cumulativeDistances } from '../lib/elevation.js'
import {
  clusterCandidates,
  nearAllWithinThreshold,
  nearestIndexAtDistance,
  nearestPoint,
  pxToMeters,
} from '../lib/mapInteractions.js'

// トラックラインの当たり判定幅（px）。見た目の線幅（weight:4）とは独立に、
// 20px（spec.txt 7-2章の候補選択ピクセル閾値と同じ値）分の判定領域を確保する。
const TRACK_HIT_WEIGHT = 20

function pinIcon(color, label) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="38" viewBox="0 0 26 38">` +
    `<path d="M13 1C6.9 1 2 5.9 2 12c0 9.5 11 24 11 24S24 21.5 24 12C24 5.9 19.1 1 13 1z"` +
    ` fill="${color}" stroke="white" stroke-width="1.5"/>` +
    `<text x="13" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold"` +
    ` font-family="sans-serif">${label}</text></svg>`
  return L.divIcon({ html: svg, iconSize: [26, 38], iconAnchor: [13, 38], className: '' })
}

function acptIcon(useRouting) {
  // spec.txt 7-1章（2026-09-13追加）: ルート検索OFFのacptはオレンジ枠にする
  const borderColor = useRouting === false ? '#e67e22' : '#2c3e50'
  return L.divIcon({
    html: `<div style="width:14px;height:14px;border-radius:50%;background:white;border:2px solid ${borderColor};box-sizing:border-box;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    className: '',
  })
}

function arrowIcon(deg) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<polygon points="12,2 22,20 12,14 2,20" fill="#e67e22" stroke="white" stroke-width="1.5"` +
    ` transform="rotate(${deg},12,12)"/></svg>`
  return L.divIcon({ html: svg, iconSize: [24, 24], iconAnchor: [12, 12], className: '' })
}

function makeActionButton(label, onClick) {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.style.cssText =
    'display:block;width:100%;text-align:left;cursor:pointer;border:none;background:none;' +
    'padding:5px 4px;font-family:sans-serif;font-size:13px;line-height:1.5;border-radius:3px;'
  btn.addEventListener('mouseenter', () => (btn.style.background = '#f0f0f0'))
  btn.addEventListener('mouseleave', () => (btn.style.background = 'none'))
  btn.addEventListener('click', onClick)
  return btn
}

function openActionPopup(map, latlng, items) {
  const container = document.createElement('div')
  container.style.minWidth = '180px'
  items.forEach(({ label, onClick }) => {
    container.appendChild(
      makeActionButton(label, () => {
        map.closePopup()
        onClick()
      })
    )
  })
  L.popup({ closeButton: true, closeOnClick: false, minWidth: 180 }).setLatLng(latlng).setContent(container).openOn(map)
}

/**
 * 地図表示・操作コンポーネント。spec.txt 7章（描画レイヤー・クリック候補選択）
 * ／8章（イベント処理）に対応。生のLeaflet APIをuseEffect内で命令的に操作する
 * （implement.txt 6章の方針）。
 */
const MapView = forwardRef(function MapView(
  { trkpts, trkptSegments, acpts, wpts, center, zoom, onEvent, focusCenter, hoveredKm },
  ref
) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef([])
  const cursorMarkerRef = useRef(null)
  const dataRef = useRef({ trkpts, trkptSegments, acpts, wpts, onEvent })
  const draggingRef = useRef(false)

  useEffect(() => {
    dataRef.current = { trkpts, trkptSegments, acpts, wpts, onEvent }
  })

  function emitEvent(payload) {
    const map = mapRef.current
    const c = map.getCenter()
    dataRef.current.onEvent({ ...payload, center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom(), ts: Date.now() })
  }

  function showSingleTrkptMenu(ni, lat, lng, trkpts) {
    const map = mapRef.current
    openActionPopup(map, [trkpts[ni][0], trkpts[ni][1]], [
      { label: '📍 ゴールを延長する', onClick: () => emitEvent({ type: 'dialog_result', action: 'extend', lat, lng, nearestTrkptIdx: ni }) },
      { label: '⚓ アンカーポイントを挿入する', onClick: () => emitEvent({ type: 'dialog_result', action: 'acpt', lat, lng, nearestTrkptIdx: ni }) },
      { label: '🔀 ターンポイントを追加する', onClick: () => emitEvent({ type: 'dialog_result', action: 'wpt', lat, lng, nearestTrkptIdx: ni }) },
      { label: '✖ キャンセル', onClick: () => {} },
    ])
  }

  // isTrackClick=true（トラックライン自体のクリック）の場合、20pxの候補閾値内に
  // trkptが1つも無くても「空クリック」にはしない。長い直線区間ではtrkptの間隔が
  // 画面上20pxを超えることがあり、線をクリックしているにもかかわらずゴール延長
  // 扱いになってしまう不具合の修正（2026-09-27）。トラックライン上のクリックは
  // 「ルート上のどこかをクリックした」ことが自明なため、閾値に関わらず必ず
  // 最近傍trkptに対するアクションメニューを表示する（spec.txt 7-2章
  // 「トラックライン自体をクリックした場合も、最近傍trkptに対して同じ
  // アクションメニューを表示する」）。
  function handleCandidateOrMenu(lat, lng, trkpts, wpts, { isTrackClick = false } = {}) {
    const map = mapRef.current
    const thrM = pxToMeters(20, map.getZoom(), lat)
    const cands = nearAllWithinThreshold(trkpts, lat, lng, thrM)
    if (!cands.length) {
      if (isTrackClick) {
        const nearest = nearestPoint(trkpts, lat, lng)
        if (nearest) {
          showSingleTrkptMenu(nearest.idx, lat, lng, trkpts)
          return
        }
      }
      emitEvent({ type: 'click_empty', lat, lng })
      return
    }
    const cum = cumulativeDistances(trkpts)
    const reps = clusterCandidates(cands, cum)
    const trkptToWptIdx = new Map()
    wpts.forEach((w, i) => trkptToWptIdx.set(w.trkptIdx, i))

    if (reps.length > 1) {
      openActionPopup(
        map,
        [lat, lng],
        reps.map((r) => {
          const wi = trkptToWptIdx.get(r.idx)
          if (wi !== undefined) {
            return { label: `✏ 「${wpts[wi].name}」を編集`, onClick: () => emitEvent({ type: 'wpt_click', wptIdx: wi }) }
          }
          return {
            label: '＋ 新wptを追加',
            onClick: () => emitEvent({ type: 'dialog_result', action: 'wpt', lat, lng, nearestTrkptIdx: r.idx }),
          }
        })
      )
    } else {
      showSingleTrkptMenu(reps[0].idx, lat, lng, trkpts)
    }
  }

  useImperativeHandle(ref, () => ({
    // 標高グラフのクリック（spec.txt 7-3章）: 既存wptが無い点に対して
    // 「⚓ アンカーポイントを挿入する」「🔀 ターンポイントを追加する」「✖ キャンセル」を表示する
    // （地図クリックのメニューと異なり「延長する」は含まない）
    openInsertMenuAtTrkpt(trkptIndex) {
      const map = mapRef.current
      const { trkpts } = dataRef.current
      const pt = trkpts[trkptIndex]
      if (!map || !pt) return
      openActionPopup(map, pt, [
        {
          label: '⚓ アンカーポイントを挿入する',
          onClick: () => emitEvent({ type: 'dialog_result', action: 'acpt', lat: pt[0], lng: pt[1], nearestTrkptIdx: trkptIndex }),
        },
        {
          label: '🔀 ターンポイントを追加する',
          onClick: () => emitEvent({ type: 'dialog_result', action: 'wpt', lat: pt[0], lng: pt[1], nearestTrkptIdx: trkptIndex }),
        },
        { label: '✖ キャンセル', onClick: () => {} },
      ])
    },
    // ルート読み込み直後の明示的な中心合わせ（spec.txt 7-1章）。
    // ルート全体が収まるズーム・中心に地図を合わせる。
    fitToPoints(points) {
      const map = mapRef.current
      if (!map || !points || points.length === 0) return
      if (points.length === 1) {
        map.setView(points[0], 15)
        return
      }
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 })
    },
  }))

  // 地図の生成（マウント時のみ）
  useEffect(() => {
    const map = L.map(containerRef.current).setView([center.lat, center.lng], zoom)
    mapRef.current = map
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        'routing by <a href="https://valhalla.github.io/valhalla/">Valhalla</a>',
      maxZoom: 19,
    }).addTo(map)

    map.on('click', (e) => {
      const { trkpts, wpts } = dataRef.current
      handleCandidateOrMenu(e.latlng.lat, e.latlng.lng, trkpts, wpts)
    })

    // 地図の高さ・幅はCSS（flex）で可変にしているため、コンテナのリサイズを
    // 監視してLeafletに再計算させる（Leafletはコンテナサイズ変化を自動検知しない）。
    const resizeObserver = new ResizeObserver(() => map.invalidateSize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 中心の明示的な移動（一覧パネルからのフォーカス等）
  useEffect(() => {
    if (focusCenter && mapRef.current) {
      mapRef.current.panTo([focusCenter.lat, focusCenter.lng])
    }
  }, [focusCenter])

  // レイヤーの再描画
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // acptドラッグ中に標高背景取得等の非同期dispatchでpropsが変わっても、
    // ドラッグ中のマーカーごとレイヤーを作り直してドラッグ操作を中断させない。
    // dragend時のACPT_DRAG_END dispatchで最終的に最新状態が反映される。
    if (draggingRef.current) return

    layersRef.current.forEach((layer) => map.removeLayer(layer))
    layersRef.current = []
    const addLayer = (layer) => {
      layer.addTo(map)
      layersRef.current.push(layer)
    }

    // spec.txt 7-1章（2026-09-13追加）: ルート検索OFFの区間（直線）は破線で
    // 描画し、ルート検索された区間（実線）と視覚的に区別する
    const segments = trkptSegments && trkptSegments.length ? trkptSegments : trkpts.length > 1 ? [{ points: trkpts, routed: true }] : []
    segments.forEach((seg) => {
      const poly = L.polyline(seg.points, {
        color: '#3498db',
        weight: 4,
        opacity: 0.8,
        dashArray: seg.routed ? null : '6 6',
        interactive: false, // クリック判定は下記hitLineに一元化する
      })
      addLayer(poly)

      // 見た目の線（weight:4）とは別に、当たり判定だけを太くした透明な線を
      // 重ねる（2026-09-27追加）。見た目の線幅のままではクリック可能領域が
      // 狭く、直線の少し外れた位置をクリックすると空クリック（ゴール延長）
      // 判定になってしまっていたため。TRACK_HIT_WEIGHTは他の候補選択の
      // ピクセル閾値（spec.txt 7-2章、20px）に合わせている。
      const hitLine = L.polyline(seg.points, {
        color: '#000',
        weight: TRACK_HIT_WEIGHT,
        opacity: 0,
      })
      hitLine.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        handleCandidateOrMenu(e.latlng.lat, e.latlng.lng, trkpts, wpts, { isTrackClick: true })
      })
      addLayer(hitLine)
    })

    wpts.forEach((w, i) => {
      let marker
      if (i === 0) {
        marker = L.marker([w.lat, w.lng], { icon: pinIcon('#27ae60', 'S') }).bindTooltip(`スタート: ${w.name}（右クリックで削除確認）`)
      } else if (i === wpts.length - 1) {
        marker = L.marker([w.lat, w.lng], { icon: pinIcon('#c0392b', 'G') }).bindTooltip(`ゴール: ${w.name}（右クリックで削除確認）`)
      } else {
        marker = L.circleMarker([w.lat, w.lng], {
          radius: 9,
          color: w.color,
          fillColor: w.color,
          fillOpacity: 0.9,
          weight: 2,
        }).bindTooltip(`wpt:${i + 1} ${w.name}（右クリックで削除確認）`)
      }
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        const thrM = pxToMeters(20, map.getZoom(), w.lat)
        const cands = nearAllWithinThreshold(trkpts, w.lat, w.lng, thrM)
        const cum = cumulativeDistances(trkpts)
        const reps = clusterCandidates(cands, cum)
        if (reps.length > 1) {
          handleCandidateOrMenu(w.lat, w.lng, trkpts, wpts)
        } else {
          emitEvent({ type: 'wpt_click', wptIdx: i })
        }
      })
      marker.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e)
        L.DomEvent.preventDefault(e)
        openActionPopup(map, e.latlng, [
          { label: '🗑 削除する', onClick: () => emitEvent({ type: 'wpt_delete', trkptIdx: w.trkptIdx }) },
          { label: '✖ 何もしない', onClick: () => {} },
        ])
      })
      addLayer(marker)
    })

    acpts.forEach((a, i) => {
      const marker = L.marker([a.lat, a.lng], {
        icon: acptIcon(a.useRouting),
        draggable: true,
        zIndexOffset: 500,
      }).bindTooltip(`acpt:${i + 1}${a.useRouting === false ? '（ルート検索OFF）' : ''}（右クリックで削除確認）`)
      marker.on('dragstart', () => {
        draggingRef.current = true
      })
      marker.on('dragend', (e) => {
        draggingRef.current = false
        const pos = e.target.getLatLng()
        emitEvent({ type: 'acpt_drag_end', acptIdx: i, lat: pos.lat, lng: pos.lng })
      })
      // spec.txt 7-2/7-4章（2026-09-13追加）: acptマーカークリックで
      // ルート検索ON/OFF切替・削除のアクションメニューを表示する
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        const label = a.useRouting === false ? '🔀 ルート検索をONに切り替える' : '🔀 ルート検索をOFFに切り替える'
        openActionPopup(map, e.latlng, [
          { label, onClick: () => emitEvent({ type: 'acpt_toggle_routing', acptIdx: i }) },
          { label: '🗑 削除する', onClick: () => emitEvent({ type: 'acpt_delete', acptIdx: i }) },
          { label: '✖ キャンセル', onClick: () => {} },
        ])
      })
      marker.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e)
        L.DomEvent.preventDefault(e)
        const items = []
        // spec.txt 8-3章（2026-09-13追加）: wptが未設定のacptのみ表示する
        if (!a.hasWpt) {
          items.push({
            label: '🔀 ターンポイントに変更する',
            onClick: () => emitEvent({ type: 'dialog_result', action: 'wpt', lat: a.lat, lng: a.lng, nearestTrkptIdx: a.trkptIdx }),
          })
        }
        items.push(
          { label: '🗑 削除する', onClick: () => emitEvent({ type: 'acpt_delete', acptIdx: i }) },
          { label: '✖ 何もしない', onClick: () => {} }
        )
        openActionPopup(map, e.latlng, items)
      })
      addLayer(marker)
    })
  }, [trkpts, trkptSegments, acpts, wpts])

  // 標高グラフhover位置に対応するカーソル矢印。spec.txt 7-3章
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (cursorMarkerRef.current) {
      map.removeLayer(cursorMarkerRef.current)
      cursorMarkerRef.current = null
    }
    if (hoveredKm === null || hoveredKm === undefined || trkpts.length < 2) return

    const cumDists = cumulativeDistances(trkpts)
    const idx = nearestIndexAtDistance(cumDists, hoveredKm * 1000)
    const n = trkpts.length
    const a = idx > 0 ? idx - 1 : idx
    const b = idx < n - 1 ? idx + 1 : idx
    const deg = calculateBearing(trkpts[a][0], trkpts[a][1], trkpts[b][0], trkpts[b][1])
    cursorMarkerRef.current = L.marker(trkpts[idx], { icon: arrowIcon(deg), zIndexOffset: 1000, interactive: false }).addTo(map)
  }, [hoveredKm, trkpts])

  return <div ref={containerRef} className="map-view" />
})

export default MapView
