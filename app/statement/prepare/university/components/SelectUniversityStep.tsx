// STEP 1: 大学選択。
// STEP-PAGE-01 で app/statement/prepare/university/page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。state は parent (page.tsx) が保持し、本 component は値と setter を
//   受け取って表示する。preferences / history は parent から渡る。
//   過去ログ 1 行の表示は sibling component HistoryEntryCard に委譲する。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard（isMounted 値は props として受け取るだけ）

'use client';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Input } from '@/components/ui/Input';
import { AlertBox } from '@/components/ui/AlertBox';
import type { SchoolPreference } from '@/types/basicInfo';
import type { UniversityPrepareEntry } from '@/lib/statement/prepare/universityPrepareHistory';
import { HistoryEntryCard } from './HistoryEntryCard';

export function SelectUniversityStep({
  isMounted,
  preferences,
  manualUniversity,
  setManualUniversity,
  manualFaculty,
  setManualFaculty,
  manualDepartment,
  setManualDepartment,
  error,
  onPickPreference,
  onUseManual,
  history,
}: {
  isMounted: boolean;
  preferences: SchoolPreference[];
  manualUniversity: string;
  setManualUniversity: (v: string) => void;
  manualFaculty: string;
  setManualFaculty: (v: string) => void;
  manualDepartment: string;
  setManualDepartment: (v: string) => void;
  error: string;
  onPickPreference: (p: SchoolPreference) => void;
  onUseManual: () => void;
  history: UniversityPrepareEntry[];
}) {
  return (
    <>
      <Card className="mb-6">
        <h2 className="text-base font-bold text-slate-900 mb-1">
          整理したい大学を選んでください
        </h2>
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          大学ごとの理念・評価軸に合わせて深掘り質問を出します。
        </p>

        {isMounted && preferences.length > 0 && (
          <ul className="space-y-2 mb-5">
            {preferences.map((p, i) => (
              <li key={`${p.university}-${p.faculty}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPickPreference(p)}
                  className="w-full text-left rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    {p.university || '（大学未入力）'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.faculty || '（学部未入力）'}
                    {p.department ? `　${p.department}` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {isMounted && preferences.length === 0 && (
          <p className="text-xs text-slate-500 mb-3">
            基本情報に志望校が未登録です。下の入力欄から大学を指定して進めてください。
          </p>
        )}

        <div className="rounded-lg border border-dashed border-slate-300 p-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-700 mb-3">
            別の大学で整理する場合（手入力）
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="manual-uni">志望大学</Label>
              <Input
                id="manual-uni"
                value={manualUniversity}
                onChange={(e) => setManualUniversity(e.target.value)}
                placeholder="例：○○大学"
              />
            </div>
            <div>
              <Label htmlFor="manual-faculty">学部名</Label>
              <Input
                id="manual-faculty"
                value={manualFaculty}
                onChange={(e) => setManualFaculty(e.target.value)}
                placeholder="例：国際文化学部"
              />
            </div>
            <div>
              <Label htmlFor="manual-department">学科名（任意）</Label>
              <Input
                id="manual-department"
                value={manualDepartment}
                onChange={(e) => setManualDepartment(e.target.value)}
                placeholder="例：国際文化学科"
              />
            </div>
          </div>
          {error && (
            <AlertBox variant="warning" className="mt-3">
              {error}
            </AlertBox>
          )}
          <div className="mt-4">
            <Button variant="primary" onClick={onUseManual}>
              この大学で深掘り質問を出す →
            </Button>
          </div>
        </div>
      </Card>

      {isMounted && history.length > 0 && (
        <Card className="mb-6 bg-slate-50 border-slate-200">
          <h2 className="text-sm font-bold text-slate-900 mb-1">
            これまでに整理した記録（最新{history.length}件）
          </h2>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            クリックで整理メモと回答を確認できます。
          </p>
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id}>
                <HistoryEntryCard entry={h} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
