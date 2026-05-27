// 改善前後の比較ページ（essay STEP H 新規、view only）。
//
// 役割:
//   1 回の改善ワーク（深掘り → AI まとめ → 書き直し → 再添削）が完了した直後に、
//   reviews.at(-2)（前回）と reviews.at(-1)（今回）を並べて成長を可視化する。
//
// guard:
//   - workspace 不在 → NotFound
//   - reviews.length < 2 → 「比較できる添削結果がありません」（戻り link は /essay/result/[wid]）
//
// 触らないもの（STEP H は view only）:
//   - reviews の並び替え / 削除
//   - body / improvementInProgress
//   - AI route の再呼び出し
//   - score の再計算（保存値をそのまま使う）

'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { loadEssayWorkspace } from '@/lib/essayWorkspaceStorage';
import { BreakdownDiffRow } from '@/app/essay/components/BreakdownDiffRow';
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from '@/components/ui/buttonStyles';
import type { EssayWorkspace, ReviewEntry } from '@/types/essay';

// SSR-stable mount flag。既存ページと同形パターン。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// breakdown 行を curr の順序ベースで揃え、prev 側にしか無いラベルは末尾に追加する。
// label 不一致時は missing 側を 0 として扱う（仕様）。
type DiffRow = {
  label: string;
  prevScore: number;
  currScore: number;
  delta: number;
};

function computeBreakdownDiff(prev: ReviewEntry, curr: ReviewEntry): DiffRow[] {
  const prevMap = new Map(prev.breakdown.map((b) => [b.label, b.score]));
  const currMap = new Map(curr.breakdown.map((b) => [b.label, b.score]));

  const seen = new Set<string>();
  const rows: DiffRow[] = [];

  for (const item of curr.breakdown) {
    seen.add(item.label);
    const prevScore = prevMap.get(item.label) ?? 0;
    rows.push({
      label: item.label,
      prevScore,
      currScore: item.score,
      delta: item.score - prevScore,
    });
  }
  // prev にあって curr に無い軸（通常は発生しないが label 集合変更時の防御）
  for (const item of prev.breakdown) {
    if (seen.has(item.label)) continue;
    rows.push({
      label: item.label,
      prevScore: item.score,
      currScore: currMap.get(item.label) ?? 0,
      delta: -item.score,
    });
  }
  return rows;
}

export default function EssayCompareReviewPage() {
  const params = useParams<{ wid: string }>();
  const wid = params?.wid ?? '';

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const workspace = useMemo<EssayWorkspace | null>(
    () => (isMounted && wid ? loadEssayWorkspace(wid) : null),
    [isMounted, wid],
  );

  // pre-mount: 読み込み中。
  if (!isMounted) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-sm text-gray-500">読み込み中…</div>
      </div>
    );
  }

  // workspace 不在 / 退役済み。
  if (!workspace) {
    return (
      <GuardScreen
        backHref="/essay/results"
        backLabel="← 一覧に戻る"
        title="見つかりませんでした"
        body="指定された結果は存在しないか、保存件数の上限を超えて退役した可能性があります。"
      />
    );
  }

  // reviews.length < 2: 比較できない。
  if (workspace.reviews.length < 2) {
    return (
      <GuardScreen
        backHref={`/essay/result/${wid}`}
        backLabel="← 結果ページへ戻る"
        title="比較できる添削結果がありません"
        body="改善ワークを 1 回完了させると、前回と今回の比較が表示されます。"
      />
    );
  }

  // 末尾 2 件で比較（append-only 保証により時系列は常に正しい）。
  const prev = workspace.reviews.at(-2)!;
  const curr = workspace.reviews.at(-1)!;
  const totalDelta = curr.totalScore - prev.totalScore;
  const breakdownDiff = computeBreakdownDiff(prev, curr);

  const totalDeltaText =
    totalDelta === 0 ? '±0' : totalDelta > 0 ? `+${totalDelta}` : `${totalDelta}`;
  const totalDeltaClass =
    totalDelta > 0
      ? 'text-blue-700'
      : totalDelta < 0
        ? 'text-amber-700'
        : 'text-gray-500';

  const verdictChanged = prev.verdict !== curr.verdict;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/essay/result/${wid}`}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← 結果ページへ戻る
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 leading-snug">
          改善前後の比較
        </h1>
        <p className="text-xs text-gray-500">
          前回の添削（第 {workspace.reviews.length - 1} 回）と今回（第 {workspace.reviews.length} 回）を並べて表示しています。
        </p>
      </div>

      {/* 総合スコアの比較 */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <p className="text-xs font-semibold text-gray-600 mb-4">総合スコア</p>
        <div className="flex items-center justify-center gap-4 sm:gap-8">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">前回</p>
            <p className="text-3xl font-bold text-gray-500">{prev.totalScore}</p>
            <p className="text-xs text-gray-400 mt-1">{prev.verdict}</p>
          </div>
          <span className="text-gray-300 text-2xl" aria-hidden>
            →
          </span>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">今回</p>
            <p className="text-4xl font-bold text-gray-900">{curr.totalScore}</p>
            <p className="text-xs text-gray-600 mt-1">{curr.verdict}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">差分</p>
            <p className={`text-3xl font-bold ${totalDeltaClass}`}>
              {totalDeltaText}
            </p>
          </div>
        </div>
        {verdictChanged && (
          <p className="mt-4 text-xs text-center text-blue-700">
            判定が「{prev.verdict}」から「{curr.verdict}」に変わりました。
          </p>
        )}
      </section>

      {/* breakdown 差分 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">軸別スコア</p>
        <div className="space-y-2">
          {breakdownDiff.map((row) => (
            <BreakdownDiffRow
              key={row.label}
              label={row.label}
              prevScore={row.prevScore}
              currScore={row.currScore}
              delta={row.delta}
            />
          ))}
        </div>
      </section>

      {/* improvement の変化 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">
          最重要の改善点
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">前回</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              {prev.improvement || (
                <span className="text-gray-400">（なし）</span>
              )}
            </p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="text-xs text-blue-700 mb-1">今回</p>
            <p className="text-sm text-gray-800 leading-relaxed">
              {curr.improvement || (
                <span className="text-gray-400">（なし）</span>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* goodPoints の変化 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">良かった点</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-2">前回</p>
            <PointList items={prev.goodPoints} />
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="text-xs text-blue-700 mb-2">今回</p>
            <PointList items={curr.goodPoints} />
          </div>
        </div>
      </section>

      {/* weakPoints の変化 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
        <p className="text-sm font-semibold text-gray-700 mb-3">
          改善できる点
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-2">前回</p>
            <PointList items={prev.weakPoints} />
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
            <p className="text-xs text-amber-700 mb-2">今回</p>
            <PointList items={curr.weakPoints} />
          </div>
        </div>
      </section>

      {/* CTA: 次の改善 / 結果ページへ */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href={`/essay/improve/${wid}`}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          次の改善に進む
        </Link>
        <Link
          href={`/essay/result/${wid}`}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.outline} ${BUTTON_SIZE.md}`}
        >
          結果ページへ戻る
        </Link>
      </div>
    </div>
  );
}

// ─── small sub-component ───────────────────────────────────────────

function PointList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400">（なし）</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((p, i) => (
        <li key={i} className="text-sm text-gray-800 leading-relaxed">
          ・{p}
        </li>
      ))}
    </ul>
  );
}

function GuardScreen({
  backHref,
  backLabel,
  title,
  body,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          {backLabel}
        </Link>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-800 mb-2">{title}</h1>
        <p className="text-sm text-gray-600">{body}</p>
      </div>
    </div>
  );
}
