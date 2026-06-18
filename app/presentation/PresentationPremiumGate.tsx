'use client';

// プレゼン機能の Premium 限定ゲート（クライアント側 UX 層）。
//
// 方針:
//   - プレゼンは Premium 限定（quota: free/basic=0, premium=20）。PlanGate は free のみ /pricing へ
//     飛ばす（basic は通す）ため、Premium 限定（basic も不可）はここでページ側に出し分ける。
//   - 最終防衛は API 側 ensurePlanQuota（402）。本ゲートは「閲覧時の案内・導線」を担う UX 層。
//   - premium / QA バイパスのみ children を表示。未ログイン・Free・Basic には Premium 案内 +
//     /pricing 導線（既存 Pricing 導線の流用）を表示する。

import type { ReactNode } from 'react';

import { useAuthDebug, useProfile } from '@/app/components/AuthProvider';
import { AlertBox } from '@/components/ui/AlertBox';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

export function PresentationPremiumGate({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const { authReady, profileReady } = useAuthDebug();
  const ready = authReady && profileReady;

  if (!ready) {
    return <p className="text-sm text-slate-500">確認中です…</p>;
  }

  const isPremium =
    profile !== null && (profile.plan === 'premium' || profile.isQaUser);

  if (!isPremium) {
    return (
      <Card padding="lg" className="space-y-4">
        <AlertBox variant="info">
          プレゼン機能は <strong>Premium プラン限定</strong>の機能です。
        </AlertBox>
        <p className="text-sm text-slate-600 leading-relaxed">
          録画したプレゼンを AI がカテゴリ評価し、発表後には AI が深掘り質問を行います。
          ご利用には Premium プランへのアップグレードが必要です。
        </p>
        <LinkButton href="/pricing" variant="primary">
          Premium プランを見る
        </LinkButton>
      </Card>
    );
  }

  return <>{children}</>;
}
