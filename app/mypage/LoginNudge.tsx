'use client';

// STEP-AUTH-P0: マイページ上部のログイン誘導バナー。
//
// 表示条件:
//   auth が確定済み（authReady）かつ 永続ユーザーでない（匿名 / メール未連携）とき。
//   永続ユーザー（メールログイン済み）には何も描画しない。
//
// 目的:
//   匿名のままだと別端末で別 auth.users.id になり「課金済みでも Free 表示 /
//   データが見えない」事故が起きる。メールログインを促し、同一アカウント復帰を可能にする。
//
// 原則: identity は触らない（読み取りのみ）。/login へ誘導するだけ。

import Link from 'next/link';

import { useAuthDebug, useIsPermanentUser } from '@/app/components/AuthProvider';
import { Card } from '@/components/ui/Card';

export function LoginNudge() {
  const isPermanentUser = useIsPermanentUser();
  const { authReady } = useAuthDebug();

  // 未確定のうちは出さない（チラつき防止）。永続ユーザーには不要。
  if (!authReady || isPermanentUser) return null;

  return (
    <Card variant="soft" padding="md" className="mt-4 border border-amber-200">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            別端末でも同じアカウントを使うには、メールログインを完了してください
          </p>
          <p className="mt-1 text-xs text-amber-800 leading-relaxed">
            メールでログインすると、Mac・スマホ・別ブラウザでも同じ学習データと
            契約状態に戻れます。完了するまではこの端末でのみ利用できます。
          </p>
        </div>
        <Link
          href="/login?next=/mypage"
          className="shrink-0 inline-flex items-center justify-center font-bold text-sm px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition-colors"
        >
          メールでログイン
        </Link>
      </div>
    </Card>
  );
}
