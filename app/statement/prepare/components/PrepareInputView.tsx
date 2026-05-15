// STEP8.6/8.7: 志望理由書 prepare 画面の入力フォーム view。
//   STEP8.6 で page.tsx 内 top-level function として logical split、STEP8.7 で
//   feature-local component file として physical split。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。

import type { Dispatch, SetStateAction } from 'react';
import { Card } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { AlertBox } from '@/components/ui/AlertBox';
import {
  FACULTY_CATEGORY_LIST,
  getFacultyCategoryLabel,
  isFacultyCategory,
  type FacultyCategory,
} from '@/lib/facultyCategory';
import type { StatementPrepareLimitStatus } from '@/lib/statement/prepare/statementPrepareLimit';

export type PrepareInputViewProps = {
  interest: string;
  setInterest: Dispatch<SetStateAction<string>>;
  experience: string;
  setExperience: Dispatch<SetStateAction<string>>;
  future: string;
  setFuture: Dispatch<SetStateAction<string>>;
  facultyCategory: FacultyCategory;
  setFacultyCategory: Dispatch<SetStateAction<FacultyCategory>>;
  validationError: string;
  apiError: string;
  loading: boolean;
  mounted: boolean;
  limitStatus: StatementPrepareLimitStatus;
  savedSummaryMeta: { updatedAt: string } | null;
  onSummarize: () => void;
  onViewSavedSummary: () => void;
};

export function PrepareInputView({
  interest, setInterest,
  experience, setExperience,
  future, setFuture,
  facultyCategory, setFacultyCategory,
  validationError, apiError,
  loading,
  mounted,
  limitStatus,
  savedSummaryMeta,
  onSummarize, onViewSavedSummary,
}: PrepareInputViewProps) {
  return (
    <Card className="mb-6">
      <div className="space-y-6">
        {/* STEP 29: 学部系統 select。API には送らず、整理結果画面のヒント表示にだけ使う。 */}
        <div>
          <Label htmlFor="prepare-faculty">志望学部の系統</Label>
          <p className="text-xs text-gray-500 mb-2 -mt-1">
            大学DBが入るまでは、学部系統に合わせて確認ポイントを出します。
          </p>
          <select
            id="prepare-faculty"
            value={facultyCategory}
            onChange={(e) => {
              const v = e.target.value;
              if (isFacultyCategory(v)) setFacultyCategory(v);
            }}
            disabled={loading}
            className="w-full sm:w-72 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            {FACULTY_CATEGORY_LIST.map((c) => (
              <option key={c} value={c}>
                {getFacultyCategoryLabel(c)}
              </option>
            ))}
          </select>
        </div>

        {/* 質問1 */}
        <div>
          <Label htmlFor="prepare-q1">
            なぜその分野・学部に興味を持ちましたか？
          </Label>
          <p className="text-xs text-gray-500 mb-2 -mt-1">
            きっかけだけでもOKです。短くて構いません。
          </p>
          <Textarea
            id="prepare-q1"
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            rows={4}
            placeholder="例：高校の授業で扱ったテーマが面白かった／ニュースで気になった話題があった　など"
            className="resize-y"
            disabled={loading}
          />
        </div>

        {/* 質問2 */}
        <div>
          <Label htmlFor="prepare-q2">
            印象に残っている経験はありますか？
          </Label>
          <p className="text-xs text-gray-500 mb-2 -mt-1">
            部活・探究・留学・アルバイト・資格・読書・趣味など、何でもOK。1〜2行でも十分です。
          </p>
          <Textarea
            id="prepare-q2"
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            rows={4}
            placeholder="例：探究で地域の商店街を取材した／海外短期留学で価値観の違いに驚いた　など"
            className="resize-y"
            disabled={loading}
          />
        </div>

        {/* 質問3 */}
        <div>
          <Label htmlFor="prepare-q3">
            将来どんなことをしたいですか？
          </Label>
          <p className="text-xs text-gray-500 mb-2 -mt-1">
            まだ決まっていなくても、「興味がある方向性」で大丈夫です。
          </p>
          <Textarea
            id="prepare-q3"
            value={future}
            onChange={(e) => setFuture(e.target.value)}
            rows={4}
            placeholder="例：地域に関わる仕事がしたい／海外と関わりたい／まだ模索中　など"
            className="resize-y"
            disabled={loading}
          />
        </div>
      </div>

      {validationError && (
        <AlertBox variant="warning" className="mt-6">
          {validationError}
        </AlertBox>
      )}

      {apiError && (
        <AlertBox variant="error" className="mt-6">
          {apiError}
        </AlertBox>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <Button
          variant="primary"
          onClick={onSummarize}
          disabled={loading || (mounted && !limitStatus.canUse)}
        >
          {loading ? '整理中...' : '整理する'}
        </Button>
        {/* STEP 31: 保存済み整理メモがあるときだけ表示。API は呼ばない復元ボタン。 */}
        {mounted && savedSummaryMeta && (
          <Button
            variant="secondary"
            size="md"
            onClick={onViewSavedSummary}
            disabled={loading}
          >
            以前作った整理メモを見る
          </Button>
        )}
        <LinkButton href="/statement" variant="secondary" size="md">
          戻る
        </LinkButton>
        <span className="ml-auto text-xs text-slate-500">
          本日の整理回数：
          {mounted ? (
            <span
              className={
                limitStatus.remaining === 0
                  ? 'text-red-500 font-semibold'
                  : limitStatus.remaining === 1
                    ? 'text-yellow-600 font-semibold'
                    : 'text-slate-700 font-semibold'
              }
            >
              {limitStatus.count}
            </span>
          ) : (
            <span className="text-slate-400">-</span>
          )}
          <span className="text-slate-400"> / {limitStatus.limit} 回</span>
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        ※ 同じ入力で再表示する場合（保存済み再利用）はカウントされません。
      </p>
    </Card>
  );
}
