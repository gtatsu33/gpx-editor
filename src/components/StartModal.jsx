import { useRef, useState } from 'react'

// spec.txt 3-4章: スタート画面の招待ユーザー向けログイン導線（⚙️アイコン→ポップオーバー）。
// implement.txt 13章: メールクライアントのリンクプリフェッチでワンタイムリンクが
// 無効化される問題を避けるため、リンククリックではなく6桁コード手入力方式を使う。
function LoginPopover({ isLoggedIn, userEmail, onSendMagicLink, onVerifyOtp, onSignOut }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState(null)

  async function handleSend() {
    setSending(true)
    setResult(null)
    const res = await onSendMagicLink(email)
    setSending(false)
    setResult(res)
    if (res.ok) setCodeSent(true)
  }

  async function handleVerify() {
    setVerifying(true)
    setResult(null)
    const res = await onVerifyOtp(email, code)
    setVerifying(false)
    setResult(res)
  }

  return (
    <div className="login-popover-wrap">
      <button
        type="button"
        className="login-gear-btn"
        onClick={() => setOpen((v) => !v)}
        title="招待ユーザー向けログイン"
      >
        ⚙️
      </button>
      {open && (
        <div className="login-popover">
          {isLoggedIn ? (
            <>
              <p>ログイン中: {userEmail}</p>
              <button type="button" className="btn-secondary" onClick={onSignOut}>
                ログアウト
              </button>
            </>
          ) : !codeSent ? (
            <>
              <p>招待ユーザー向けログイン</p>
              <input
                type="email"
                className="text-input"
                placeholder="メールアドレス"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="button" className="btn-primary" onClick={handleSend} disabled={!email || sending}>
                {sending ? '送信中…' : 'ログインコードを送る'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                キャンセル
              </button>
              {result && !result.ok && <p className="error">送信に失敗しました: {result.error}</p>}
            </>
          ) : (
            <>
              <p>メールに届いた6桁のコードを入力してください。</p>
              <input
                type="text"
                inputMode="numeric"
                className="text-input"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button type="button" className="btn-primary" onClick={handleVerify} disabled={!code || verifying}>
                {verifying ? '確認中…' : 'ログイン'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setCodeSent(false)}>
                戻る
              </button>
              {result && !result.ok && <p className="error">確認に失敗しました: {result.error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// spec.txt 3章・implement.txt 1章: スタート画面モーダル。
// キャンセル不可（閉じるボタンを持たない）。いずれかの選択肢を選ぶまで表示し続ける。
function StartModal({
  error,
  onFileChange,
  onOpenNetworkPicker,
  onNewRoute,
  isLoggedIn,
  userEmail,
  onSendMagicLink,
  onVerifyOtp,
  onSignOut,
}) {
  const [isActualRide, setIsActualRide] = useState(false)
  const fileInputRef = useRef(null)

  return (
    <div className="modal-overlay">
      <div className="modal-box start-modal">
        <LoginPopover
          isLoggedIn={isLoggedIn}
          userEmail={userEmail}
          onSendMagicLink={onSendMagicLink}
          onVerifyOtp={onVerifyOtp}
          onSignOut={onSignOut}
        />
        <h2>🚴 gpx-editor</h2>
        <div className="start-modal-cards">
          <div className="start-card">
            <h3>GPXファイルを読み込む</h3>
            <label className="start-radio">
              <input
                type="radio"
                name="data-kind"
                checked={!isActualRide}
                onChange={() => setIsActualRide(false)}
              />
              🗺️ ルートデータ（Stravaルート作成など）
            </label>
            <label className="start-radio">
              <input
                type="radio"
                name="data-kind"
                checked={isActualRide}
                onChange={() => setIsActualRide(true)}
              />
              🏃 実走行データ（GPSで記録した走行ログ）
            </label>
            <p className="start-help">実走行データはマップマッチング・間引きを自動実行します</p>
            {error && <p className="error">{error}</p>}
            <div className="start-load-buttons">
              <button type="button" className="btn-primary" onClick={() => fileInputRef.current?.click()}>
                📂 ローカルからルートを選ぶ
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx,.xml"
                className="start-file-input"
                onChange={(e) => onFileChange(e, isActualRide)}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={onOpenNetworkPicker}
                disabled={!isLoggedIn}
                title={isLoggedIn ? undefined : '招待ユーザー限定の機能です'}
              >
                ☁️ クラウドからルートを選ぶ
              </button>
            </div>
          </div>
          <div className="start-card">
            <h3>新規ルートを作成する</h3>
            <ul className="start-feature-list">
              <li>📍 地図クリックでルートを延伸</li>
              <li>⚓ アンカーポイントのドラッグでルート編集</li>
              <li>🔍 交差点ターンポイントを自動検出</li>
              <li>⛰️ 国土地理院による標高補正（日本国内）</li>
            </ul>
            <button type="button" className="btn-primary" onClick={onNewRoute}>
              🗺️ 新規ルートを作成する
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StartModal
