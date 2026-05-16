// 面接の成長メモ（最小UI）。
//
// 役割:
//   STEP10.1 の buildGrowthMemo() が返す InterviewGrowthMemo を、
//   /interview/history 上部に「軽い振り返り」として描画する。
//
// 設計方針:
//   - 数値スコア / グラフ / ランクは出さない（PASSAI: 受験生に圧をかけない）
//   - 件数 + 質的言語（減少 / 増加）で「前より少し良くなった」を見せる
//   - improved / declined セクションは該当があるときだけ描画。unchanged は出さない
//   - hooks なし。pure render コンポーネント
//
// 関連:
//   types/interviewGrowth.ts
//   lib/interview/buildGrowthMemo.ts
//   app/interview/history/components/InterviewHistoryClient.tsx (consumer)

'use client';

import Link from 'next/link';
import type { InterviewGrowthMemo as InterviewGrowthMemoType } from '@/types/interviewGrowth';
import { inferStatementFocus } from '@/lib/interview/inferStatementFocus';

type Props = {
  memo: InterviewGrowthMemoType;
};

const REMAINING_ISSUES_DISPLAY_MAX = 2;

export function InterviewGrowthMemo({ memo }: Props) {
  // improved / declined を分けて表示。unchanged は意図的に表示しない（情報量を抑える）。
  const improvedDeltas = memo.axisDeltas.filter((d) => d.direction === 'improved');
  const declinedDeltas = memo.axisDeltas.filter((d) => d.direction === 'declined');

  const hasDates = memo.previousDate !== '' || memo.currentDate !== '';

  // 「志望理由書を改善する」CTA に focus 推定を載せる。先頭の課題から軽量推定。
  // 推定不可ならクエリ無しの /statement/edit へ。
  const primaryIssue = memo.remainingIssues[0];
  const inferredFocus = primaryIssue ? inferStatementFocus(primaryIssue) : null;
  const statementEditHref = inferredFocus
    ? `/statement/edit?focus=${inferredFocus}`
    : '/statement/edit';

  return (
    <section className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 mb-6">
      <p className="text-sm font-semibold text-emerald-900 mb-1">面接の成長メモ</p>

      {hasDates && (
        <p className="text-xs text-emerald-800 mb-3">
          前回（{memo.previousDate || '日付なし'}）→ 今回（{memo.currentDate || '日付なし'}）
        </p>
      )}

      {improvedDeltas.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-emerald-800 mb-1">改善した点</p>
          <ul className="text-sm text-emerald-900 leading-relaxed space-y-1">
            {improvedDeltas.map((d) => (
              <li key={d.axis}>
                ・{d.label} の weak が {d.prevWeakCount}件 → {d.currWeakCount}件に減少
              </li>
            ))}
          </ul>
        </div>
      )}

      {declinedDeltas.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-emerald-800 mb-1">今回弱くなった点</p>
          <ul className="text-sm text-emerald-900 leading-relaxed space-y-1">
            {declinedDeltas.map((d) => (
              <li key={d.axis}>
                ・{d.label} の weak が {d.prevWeakCount}件 → {d.currWeakCount}件に増加
              </li>
            ))}
          </ul>
        </div>
      )}

      {memo.remainingIssues.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-emerald-800 mb-1">
            まだ見直したいポイント
          </p>
          <ul className="text-sm text-emerald-900 leading-relaxed space-y-1">
            {memo.remainingIssues.slice(0, REMAINING_ISSUES_DISPLAY_MAX).map((issue) => (
              <li key={issue}>・{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* CTA 2 つ並列。改善 (amber) → 再練習 (emerald) の順に並べ、
          「直してから次の練習へ」という PASSAI 循環の自然な流れに合わせる。
          flex-wrap で狭い画面では縦並びに自動折り返す。 */}
      <div className="flex flex-wrap gap-3">
        <Link
          href={statementEditHref}
          className="inline-block text-sm font-semibold text-amber-900 hover:text-amber-700 border border-amber-300 hover:border-amber-400 px-4 py-2 rounded-lg transition-colors"
        >
          志望理由書を改善する
        </Link>
        <Link
          href="/interview/questions"
          className="inline-block text-sm font-semibold text-emerald-900 hover:text-emerald-700 border border-emerald-300 hover:border-emerald-400 px-4 py-2 rounded-lg transition-colors"
        >
          もう一度面接練習する
        </Link>
      </div>
    </section>
  );
}
