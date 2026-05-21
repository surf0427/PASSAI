// STEP8.4/8.5: 志望理由書 edit 画面の詳細分析 Accordion content view。
//   STEP8.4 で page.tsx 内 top-level function として logical split、STEP8.5 で
//   feature-local component file として physical split。
//   Accordion 自体は layout primitive として page 側に残し、本 view はその children を返す。
//   state ownership / hook ownership は page.tsx 側に維持。本 view は props を受け取って
//   render するだけの pure-ish 関数。
//
// ── ②「志望理由書を書く機能」整理 ────────────────────────────────
// 過去の添削履歴一覧（restore / delete / clear all）は、過去ログ閲覧を ③
// /statement/score（view 機能）に分離するため、本 view からは削除。
// 履歴自体の保存（saveReviewHistory）/ 読み込み（loadReviewHistory）/ storage
// （statementReviewHistory）は無変更。表示レイヤだけ閉じている。

import { NgWordCheck } from '@/components/statement/NgWordCheck';
import { StructureCheck } from '@/components/statement/StructureCheck';
import { EvaluationAxisCheck } from '@/components/statement/EvaluationAxisCheck';
import { detectNgWords } from '@/lib/detectNgWords';
import type { StatementResult } from '@/types/statement';
import type { ActivityData } from '@/types/activity';

export type DetailAnalysisAccordionViewProps = {
  result: StatementResult | null;
  statementText: string;
  university: string;
  faculty: string;
  activities: ActivityData | null;
  onStartRewrite: (phrase: string, answers: string[]) => void;
  onInsertStarterHint: (hint: string) => void;
};

export function DetailAnalysisAccordionView({
  result,
  statementText,
  university,
  faculty,
  activities,
  onStartRewrite,
  onInsertStarterHint,
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
    </div>
  );
}
