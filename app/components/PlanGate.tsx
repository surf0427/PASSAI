'use client';

// 課金認可ガード（クライアント側）。
//
// 方針:
//   - 認証（OTP）と 認可（課金）を分離する。OTP 済みでも未課金なら PASSAI 本体機能
//     ページには入れない。
//   - middleware は使わない方針のため、layout 直下でこのコンポーネントが pathname を
//     監視し、保護対象パスに未課金で来たら /pricing へ送る。
//   - 最終防衛は API 側の planGate（402）。本ガードは「ページ閲覧・遷移」を塞ぐ層。
//
// 判定:
//   - 保護対象パス（PROTECTED_PREFIXES）で profile.plan が free のとき /pricing へ replace。
//   - 許可パス（LP / login / mypage / billing / account / input/basic / diagnosis / 法務 等）は
//     未課金でも素通し。/pricing 自身も非保護（ループ防止）。
//   - profile 取得失敗（ready かつ profile===null）は fail-open。課金済みユーザーを誤って
//     締め出さないことを優先する（profiles 行は通常 ensureProfile で必ず存在するため、
//     null は DB エラー時のみの稀ケース）。
//   - is_qa_user=true は本番確認用バイパス。API 側 planGate（402 を素通し）と挙動を揃え、
//     プランが free でも保護ページに入れる。

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { useAuthDebug, useProfile } from '@/app/components/AuthProvider';
import { DEFAULT_PLAN } from '@/types/profile';

const PRICING_ROUTE = '/pricing';

// PASSAI 本体機能（課金が必要）。ここに無いパスは未課金でも到達可能。
// 新しい有料機能ページを追加したら、この配列にも追加すること。
const PROTECTED_PREFIXES = [
  '/home',
  '/statement',
  '/essay',
  '/essay-practice',
  '/interview',
  '/matching',
  '/self-analysis',
  '/self-pr',
  '/tutor',
  '/input/activity',
  '/analyze',
  '/admission-matching',
] as const;

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

export function PlanGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const profile = useProfile();
  const { authReady, profileReady } = useAuthDebug();
  const router = useRouter();

  const protectedPath = isProtectedPath(pathname);
  const ready = authReady && profileReady;
  // 入場可 = 課金済み（free 以外）or QA バイパス。
  const isAllowed =
    profile !== null && (profile.plan !== DEFAULT_PLAN || profile.isQaUser);
  // 「未課金が確定」したときだけ弾く（fail-open: profile===null は通す）。
  const shouldBlock = protectedPath && ready && profile !== null && !isAllowed;

  useEffect(() => {
    if (shouldBlock) {
      router.replace(PRICING_ROUTE);
    }
  }, [shouldBlock, router]);

  if (protectedPath) {
    // profile 取得失敗は fail-open（既存挙動を壊さない）。
    if (ready && profile === null) {
      return <>{children}</>;
    }
    // 判定前 or 未課金確定の間は本体を描画しない（コンテンツのフラッシュ防止）。
    if (!ready || !isAllowed) {
      return (
        <div className="max-w-2xl mx-auto px-4 py-12 text-sm text-slate-500">
          確認中です…
        </div>
      );
    }
  }

  return <>{children}</>;
}
