import { useEffect, useState } from 'react'
import { getSession, onAuthStateChange, sendMagicLink, signOut, verifyOtp } from '../lib/supabase.js'

/**
 * 招待制ログイン（Supabase Auth メールOTP）のセッション管理。
 * spec.txt 19章・3-4章／implement.txt 13章。
 * メールで届く6桁コードをverifyOtpで検証してログインする
 * （メールクライアントのリンクプリフェッチでワンタイムリンクが
 * 無効化される問題を避けるため、リンククリック方式は使わない）。
 */
export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getSession().then((session) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const unsubscribe = onAuthStateChange((session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { user, loading, sendMagicLink, verifyOtp, signOut }
}
