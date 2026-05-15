// STEP8.6/8.7: 志望理由書 prepare 画面の「これまでに整理した材料」view。
//   STEP8.6 で page.tsx 内 top-level function として logical split、STEP8.7 で
//   feature-local component file として physical split。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//   mounted gate は page-level で行うため本 view 内では gate 不要（hydration 安全）。

import { Card } from '@/components/ui/Card';
import {
  buildStatementPrepareMaterials,
  type StatementPrepareMaterial,
} from '@/lib/statement/prepare/buildStatementPrepareMaterials';
import type { ActivityData } from '@/types/activity';
import type { PersistedAnalyzeState } from '@/types/analysis';

export type MaterialsViewProps = {
  materialActivity: ActivityData | null;
  materialAnalyze: PersistedAnalyzeState | null;
  onQuoteMaterial: (m: StatementPrepareMaterial) => void;
};

export function MaterialsView({
  materialActivity,
  materialAnalyze,
  onQuoteMaterial,
}: MaterialsViewProps) {
  const materials = buildStatementPrepareMaterials(materialActivity, materialAnalyze);
  return (
    <Card className="mb-6 bg-slate-50 border-slate-200">
      <h2 className="text-base font-bold text-slate-900 mb-1">
        これまでに整理した材料
      </h2>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        自己分析や活動整理で入力した内容です。志望理由書の材料として使えそうなものがあれば参考にしてください。
      </p>
      {materials.length === 0 ? (
        <p className="text-xs text-slate-400">
          まだ自己分析・活動整理の材料はありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {materials.map((m: StatementPrepareMaterial) => (
            <li
              key={m.id}
              className="rounded-lg bg-white border border-slate-200 p-3"
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    m.source === '活動整理'
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'bg-violet-100 text-violet-700 border border-violet-200'
                  }`}
                >
                  {m.source}
                </span>
                <span className="text-sm font-semibold text-slate-700">
                  {m.category}
                </span>
              </div>
              {m.body && (
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {m.body}
                </p>
              )}
              {m.reflection && (
                <p className="text-xs text-slate-500 mt-1">
                  <span className="font-semibold">学び：</span>
                  {m.reflection}
                </p>
              )}
              {m.futureConnection && (
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-semibold">将来とのつながり：</span>
                  {m.futureConnection}
                </p>
              )}
              {/* STEP 26: 種類に応じた textarea 末尾へ追記。 */}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onQuoteMaterial(m)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2"
                >
                  この内容を{m.source === '活動整理' ? '「経験」' : '「興味」'}に参考にする
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
