'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import {
  BUTTON_BASE,
  BUTTON_VARIANT,
  BUTTON_SIZE,
} from '@/components/ui/buttonStyles';
import { loadDiagnosisResult } from '@/lib/diagnosisStorage';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import { inferAnalysisType } from '@/lib/analysis/inferAnalysisType';

// ── /home → /diagnosis（受験タイプ診断）への恒久 CTA ───────────────
// 問題: DiagnosisTypeCard は結果カード表示時、CTA を feedback.ctaHref
// （活動整理 / 自己分析 / 志望理由書 …）へ向けるため、/diagnosis へ戻る導線が
// 無い。本カードはその欠けた導線を補い、「もう一度 / 改めて受ける」入口を添える。
//
// 二重 CTA 回避: DiagnosisTypeCard が結果カードでなく PromoCard を出す状態
// （= 診断結果も self-analysis 推定タイプも無い）では、PromoCard 側に強い
// /diagnosis CTA があるため、ここは何も描画しない。判定は PromoCard の抑制条件
// （DiagnosisTypeCard の resolved===null）と同じ signal を読むだけで、
// DiagnosisTypeCard 自体・self-analysis 優先表示の既存仕様には一切触れない。
//
// legacy 4タイプ / 9タイプの分岐は /diagnosis 側 flag に委ねる（ここは遷移のみ）。

const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export function DiagnosisCtaCard() {
  // hydration mismatch 回避：マウント前は描画しない（localStorage 依存のため）。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const state = useMemo<{ show: boolean; hasDiagnosis: boolean }>(() => {
    if (!isMounted) return { show: false, hasDiagnosis: false };
    // 「診断済み」= /diagnosis の結果（legacy 数値 / 9タイプ文字列のどちらでも）が保存済み。
    const hasDiagnosis = loadDiagnosisResult() != null;
    // self-analysis 由来でも DiagnosisTypeCard は結果カードを出すので、その場合も補助 CTA を出す。
    const summary = loadAnalyzeState()?.summary;
    const hasInferredType = summary ? inferAnalysisType(summary) != null : false;
    return { show: hasDiagnosis || hasInferredType, hasDiagnosis };
  }, [isMounted]);

  // 結果カードが出ていない（PromoCard 状態）なら二重 CTA を避けて非表示。
  if (!isMounted || !state.show) return null;

  const label = state.hasDiagnosis
    ? '受験タイプ診断をもう一度受ける'
    : '受験タイプ診断を受ける';
  const description = state.hasDiagnosis
    ? 'いまの自分に合わせて、受験タイプを診断し直せます。'
    : '30秒の質問で、あなたに合った対策の進め方が分かります。';

  return (
    <Card variant="soft" padding="md" className="mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1">
          <h2 className="text-base font-bold text-gray-800 mb-1.5">
            受験タイプ診断
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
        </div>
        {/* STEP-DIAGNOSIS-CTA-02: LinkButton ラッパを介さず <Link> を直接使い、
            確実に <a href="/diagnosis"> を出力する。class は LinkButton(outline / md)
            と同一の buttonStyles 定数で見た目を揃える。 */}
        <div className="shrink-0 sm:self-center">
          <Link
            href="/diagnosis"
            className={`${BUTTON_BASE} ${BUTTON_VARIANT.outline} ${BUTTON_SIZE.md}`}
          >
            {label}
          </Link>
        </div>
      </div>
    </Card>
  );
}
