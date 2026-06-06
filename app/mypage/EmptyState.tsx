'use client';

// マイページの空状態（全機能まったく未着手）。
//
// 表示条件: MypageData.summary.totalActivityCount === 0 かつ 受験タイプ診断も未実施。
// 1 機能でも履歴が 1 件あれば EmptyState は出さず、不足機能は inline で「未着手」表示にする。

import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

type Props = {
  hasDiagnosis: boolean;
};

export function EmptyState({ hasDiagnosis }: Props) {
  // FREEZE(legacy-diagnosis): /diagnosis CTA は凍結中。hasDiagnosis による出し分けは
  // 一時無効化するが、復帰を容易にするため prop は温存する（呼び出し元も変更しない）。
  void hasDiagnosis;
  return (
    <Card padding="lg" className="text-center">
      <p className="text-base font-semibold text-slate-800 mb-2">
        まだ活動データがありません
      </p>
      <p className="text-sm text-slate-600 leading-relaxed mb-6">
        最初の 1 ステップから始めましょう。<br className="hidden sm:inline" />
        ここに学習の積み重ねとスコアの推移が表示されていきます。
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {/* FREEZE(legacy-diagnosis): /diagnosis CTA は凍結中のため非表示。
        {!hasDiagnosis && (
          <LinkButton href="/diagnosis" variant="primary" size="md">
            受験タイプ診断を始める
          </LinkButton>
        )}
        */}
        <LinkButton href="/self-analysis" variant="outline" size="md">
          自己分析を始める
        </LinkButton>
        <LinkButton href="/statement" variant="outline" size="md">
          志望理由書を書いてみる
        </LinkButton>
      </div>
    </Card>
  );
}
