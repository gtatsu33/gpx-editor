import { useEffect, useRef } from 'react'
import { wptStyle } from '../lib/turns.js'

/**
 * ターンポイント一覧パネル。spec.txt 15章。
 */
export default function TurnPointList({ routePoints, turnStatus, canUndo, dispatch, onDetectTurns, onFocus, focusWpt }) {
  const currentWpts = routePoints
    .map((p, i) => (p.wpt ? { trkptIdx: i, p } : null))
    .filter(Boolean)
  const inputRefs = useRef(new Map())

  // spec.txt 8-6章: 地図上のwptクリック（標高グラフ経由含む）で該当行の
  // 名前入力欄までスクロールしてフォーカスする。
  useEffect(() => {
    if (!focusWpt) return
    const el = inputRefs.current.get(focusWpt.trkptIdx)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.focus()
    }
  }, [focusWpt])

  return (
    <div className="turn-point-list">
      <h3>📋 ターンポイント一覧　({currentWpts.length}件)</h3>
      <div className="tpl-toolbar">
        <button type="button" className="btn-secondary" onClick={onDetectTurns}>
          🔍 ターンポイント検出
        </button>
        <button type="button" className="btn-secondary" disabled={!canUndo} onClick={() => dispatch({ type: 'UNDO' })}>
          ↩ 戻す
        </button>
      </div>
      {turnStatus.state === 'running' && turnStatus.chunksRemaining > 0 && (
        <p className="tpl-warning">🔍 交差点名取得中…（残り{turnStatus.chunksRemaining}チャンク）</p>
      )}
      {currentWpts.length > 0 && (
        <div className="tpl-header-row">
          <div className="tpl-header-cols">
            <span className="tpl-col-idx">Turn#</span>
            <span className="tpl-col-dir">Dir</span>
            <span className="tpl-col-trkpt">Trkpt#</span>
          </div>
          <div className="tpl-header-spacer-input" />
          <div className="tpl-header-spacer-btn" />
        </div>
      )}
      <div className="tpl-body">
        {currentWpts.length === 0 && <p>ターンポイントがありません。</p>}
        {currentWpts.map(({ trkptIdx, p }, listIdx) => {
          const [arrow] = wptStyle(p.wpt)
          return (
            <div className="tpl-row" key={trkptIdx}>
              <button
                type="button"
                className="tpl-center-btn"
                onClick={() => {
                  onFocus({ lat: p.lat, lng: p.lon })
                  inputRefs.current.get(trkptIdx)?.focus()
                }}
              >
                <span className="tpl-col-idx">{listIdx + 1}</span>
                <span className="tpl-col-dir">{arrow}</span>
                <span className="tpl-col-trkpt">{trkptIdx}</span>
              </button>
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(trkptIdx, el)
                  else inputRefs.current.delete(trkptIdx)
                }}
                type="text"
                value={p.wpt.name}
                disabled={p.wpt.pending}
                title={p.wpt.pending ? '交差点名取得中…' : undefined}
                onChange={(e) => dispatch({ type: 'RENAME_WPT', payload: { trkptIndex: trkptIdx, name: e.target.value } })}
              />
              <button
                type="button"
                className="btn-danger btn-icon"
                title={p.wpt.pending ? '交差点名取得中…' : '削除'}
                disabled={p.wpt.pending}
                onClick={() => dispatch({ type: 'DELETE_WPT', payload: { trkptIndex: trkptIdx } })}
              >
                🗑
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
