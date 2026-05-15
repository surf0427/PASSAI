// STEP8.4/8.5: 志望理由書 edit 画面の詳細分析 Accordion content view。
//   STEP8.4 で page.tsx 内 top-level function として logical split、STEP8.5 で
//   feature-local component file として physical split。
//   Accordion 自体は layout primitive として page 側に残し、本 view はその children を返す。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//   formatDateTime は本 view 専用 helper として同居（他 view からの参照なし）。

import { NgWordCheck } from '@/components/statement/NgWordCheck';
import { StructureCheck } from '@/components/statement/StructureCheck';
import { EvaluationAxisCheck } from '@/components/statement/EvaluationAxisCheck';
import { detectNgWords } from '@/lib/detectNgWords';
import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';
import type { StatementResult } from '@/types/statement';
import type { ActivityData } from '@/types/activity';

// ── 日時フォーマット ──────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}`;
}

export type DetailAnalysisAccordionViewProps = {
  result: StatementResult | null;
  statementText: string;
  university: string;
  faculty: string;
  activities: ActivityData | null;
  onStartRewrite: (phrase: string, answers: string[]) => void;
  onInsertStarterHint: (hint: string) => void;
  history: ReviewHistoryItem[];
  onRestoreHistory: (item: ReviewHistoryItem) => void;
  onDeleteHistoryItem: (id: string) => void;
  onClearHistory: () => void;
};

export function DetailAnalysisAccordionView({
  result,
  statementText,
  university,
  faculty,
  activities,
  onStartRewrite,
  onInsertStarterHint,
  history,
  onRestoreHistory,
  onDeleteHistoryItem,
  onClearHistory,
}: DetailAnalysisAccordionViewProps) {
  return (
    <div className="space-y-6">
      {result && (
        <div className="space-y-4">
          {/* 抽象表現・NGワードチェック */}
          <NgWordCheck
            issues={detectNgWords(statementText, activities, university, faculty)}
            onStartRewrite={onStartRewrite}
            onInsertStarterHint={onInsertStarterHint}
          />

          {/* 志望理由書の構造チェック */}
          <StructureCheck text={statementText} />

          {/* 大学・学部との一致チェック */}
          <EvaluationAxisCheck
            university={university}
            faculty={faculty}
            text={statementText}
          />
        </div>
      )}

      {/* 過去の添削履歴 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-800">過去の添削履歴</h3>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-300 rounded px-3 py-1 transition-colors"
            >
              履歴を全削除
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-gray-400 text-sm">まだ履歴はありません</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="relative bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-xl transition-all"
              >
                {/* カード本体：クリックで復元 */}
                <button
                  type="button"
                  onClick={() => onRestoreHistory(item)}
                  className="w-full text-left p-4 pr-16"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">{formatDateTime(item.createdAt)}</span>
                    <span className="text-sm font-bold text-blue-700">{item.result.overallScore}点</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">
                    {item.university || '（大学未入力）'}　{item.faculty || '（学部未入力）'}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {item.essay.trim().slice(0, 30)}{item.essay.trim().length > 30 ? '…' : ''}
                  </p>
                </button>

                {/* 削除ボタン：stopPropagation でカードのクリックと分離 */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteHistoryItem(item.id); }}
                  className="absolute top-3 right-3 text-xs text-gray-300 hover:text-red-500 hover:bg-red-50 rounded px-2 py-1 transition-colors"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
