// ログイン後の料金プラン選択ページ。
//
// 未課金ユーザー（OTP 認証済みだが未契約）の遷移先。PlanGate が本体機能ページへの
// 直接アクセスをここへ送る。LP の #pricing セクションと同一 UI を再利用し、
// 課金導線（PricingCheckoutButton → /api/billing/checkout）もそのまま使う。
//
// 認証フロー・認可ロジックには手を入れない（PricingSection を描画するだけ）。

import { PricingSection } from '@/app/components/landing/PricingSection';
import { FooterSection } from '@/app/components/landing/FooterSection';

export default function PricingPage() {
  return (
    <>
      <PricingSection />
      <FooterSection />
    </>
  );
}
