'use client';

// プレゼン機能ハブ。3本立て: ①テーマ設定 → ②録画・AI評価 → ③履歴・結果確認。
// （対人プレゼン記録は MVP 対象外のため導線を持たない。）

import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

import { PresentationPremiumGate } from './PresentationPremiumGate';

export function PresentationHubClient() {
  return (
    <PresentationPremiumGate>
      <div className="space-y-4">
        {/* 1. AIプレゼン練習（テーマ設定 → 録画・AI評価） */}
        <Card padding="lg" className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">AIプレゼン対策</h2>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              録画 → AI評価 → 発表後AI質問 の流れで本番に近いプレゼン対策ができます。
              発表をブラウザで録画し、AI がカテゴリ評価（構成力・説得力・具体性 など）を行い、
              そのあと AI が内容を深掘り質問します。
            </p>
          </div>
          <LinkButton href="/presentation/university" variant="primary">
            志望大学を設定して始める
          </LinkButton>
        </Card>

        {/* 2. 過去のプレゼン履歴（履歴・結果確認） */}
        <Card padding="lg" className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">過去のプレゼン履歴</h2>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              これまでの練習結果と AI 評価を振り返れます。
            </p>
          </div>
          <LinkButton href="/presentation/history" variant="secondary">
            履歴を見る
          </LinkButton>
        </Card>
      </div>
    </PresentationPremiumGate>
  );
}
