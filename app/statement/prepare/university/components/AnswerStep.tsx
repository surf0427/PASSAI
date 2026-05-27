// STEP 2: 6 問に回答。
// STEP-PAGE-01 で app/statement/prepare/university/page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。state を持たず、parent (page.tsx) が渡す
//   answers / questions を表示し、onAnswerChange / onBack / onSubmit を起動するだけ。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard
//
// AnswerMap 型は page.tsx 側の同型と structurally identical（共有 type ファイル化は本 STEP の禁止事項）。

'use client';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { AlertBox } from '@/components/ui/AlertBox';
import type { SchoolPreference } from '@/types/basicInfo';
import type {
  UniversityFocusedQuestion,
} from '@/lib/statement/prepare/buildUniversityFocusedQuestions';
import type { UniversityFocusedQuestionId } from '@/lib/statement/prepare/universityPrepareHistory';

type AnswerMap = Record<UniversityFocusedQuestionId, string>;

export function AnswerStep({
  pref,
  questions,
  answers,
  loading,
  error,
  onAnswerChange,
  onBack,
  onSubmit,
}: {
  pref: SchoolPreference;
  questions: UniversityFocusedQuestion[];
  answers: AnswerMap;
  loading: boolean;
  error: string;
  onAnswerChange: (id: UniversityFocusedQuestionId, value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <Card className="mb-6">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
          深掘り対象
        </p>
        <p className="text-sm font-semibold text-slate-900">
          {pref.university}
          {pref.faculty ? `　${pref.faculty}` : ''}
          {pref.department ? `　${pref.department}` : ''}
        </p>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          書ける範囲で OK。完璧な文章でなくて構いません。1 問でも書ければ整理メモを生成できます。
        </p>
      </Card>

      <Card className="mb-6">
        <ol className="space-y-6">
          {questions.map((q, i) => (
            <li key={q.id}>
              <Label htmlFor={`q-${q.id}`}>
                Q{i + 1}. {q.label}
              </Label>
              {q.hint && (
                <p className="text-xs text-slate-500 mb-2 -mt-1 leading-relaxed">
                  {q.hint}
                </p>
              )}
              <Textarea
                id={`q-${q.id}`}
                value={answers[q.id] ?? ''}
                onChange={(e) => onAnswerChange(q.id, e.target.value)}
                rows={3}
                disabled={loading}
                className="resize-y"
              />
            </li>
          ))}
        </ol>

        {error && (
          <AlertBox variant="warning" className="mt-6">
            {error}
          </AlertBox>
        )}

        <div className="flex flex-wrap items-center gap-3 mt-6">
          <Button variant="primary" onClick={onSubmit} disabled={loading}>
            {loading ? '整理中...' : '整理メモを作る'}
          </Button>
          <Button variant="secondary" onClick={onBack} disabled={loading}>
            大学を選び直す
          </Button>
        </div>
      </Card>
    </>
  );
}
