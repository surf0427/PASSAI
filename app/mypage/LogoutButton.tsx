'use client';

// マイページ最下部のログアウト導線。
//
// 厳守:
//   - 既存の auth ロジック（lib/supabase/auth.ts の内部 signOut）は触らない。
//     ここはユーザー操作のログアウトとして supabase.auth.signOut() を直接呼ぶ。
//   - DB / schema / RLS / 課金 / OTP 導線 / display_user_id 判定には関与しない。
//
// 遷移先:
//   成功・失敗に関わらず LP トップ `/` へ遷移する。/home・/mypage に戻すと
//   PlanGate ループに入り得るため避ける。window.location で全リロードし、
//   AuthProvider のセッション状態も確実に初期化する。

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const supabase = getBrowserSupabaseClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {
      // signOut 失敗でもローカルセッションは概ね無効化されるため、遷移は続行する。
    } finally {
      window.location.assign('/');
    }
  };

  return (
    <div className="mt-12 pt-6 border-t border-slate-100 flex justify-center">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        disabled={loading}
        className="text-slate-500"
      >
        ログアウト
      </Button>
    </div>
  );
}
