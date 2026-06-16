'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { BasicInfo } from '@/types/basicInfo';
import type { StudentProfile } from '@/types/studentProfile';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { buildInterviewTalkingPoints } from '@/lib/buildInterviewTalkingPoints';
import { getInterviewRecords } from '@/lib/interviewRecordStorage';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { InterviewMenuCard } from './components/InterviewMenuCard';
import { InterviewTalkingPointsCard } from './components/InterviewTalkingPointsCard';

// マウント前 false / マウント後 true を返す flag。
// loadBasicInfo() は localStorage 依存のため SSR では null を返したい。
// useSyncExternalStore の getServerSnapshot/getSnapshot で setState なしにこの semantics を表現する。
// （STEP9 hooks/useActivityForm.ts と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

// STEP-INTERVIEW-AI-PR10: ハブ導線の最終整理。
//   - 実践（AI面接）を主導線として先頭に。
//   - 予想質問は「面接前の準備」ツールとして残置・位置づけを明確化（旧機能の扱い）。
//   - 履歴は対人練習 + AI面接を統合表示（PR8）する旨を文言に反映。
const MENU_ITEMS = [
  {
    title: 'AI面接を受ける（実践）',
    description:
      'AIが面接官役になり、質問と深掘りを行います。音声またはテキストで回答でき、終了後にフィードバックが出ます。',
    buttonLabel: 'AI面接を始める',
    href: '/interview/ai',
  },
  {
    title: '予想質問を作る（事前準備）',
    description:
      'AI面接や対人練習の前に。志望大学・活動内容から、聞かれそうな質問を確認できます。',
    buttonLabel: '予想質問を見る',
    href: '/interview/questions',
  },
  {
    title: '対人練習を記録する',
    description: '先生や友達との面接練習後に、質問内容や回答を記録します。',
    buttonLabel: '練習結果を記録する',
    href: '/interview/record',
  },
  {
    title: '過去の記録を見る',
    description: '対人練習とAI面接の記録・改善点をまとめて確認します。',
    buttonLabel: '記録を見る',
    href: '/interview/history',
  },
];

export default function InterviewPage() {
  // 表示用に basicInfo を取得する。共通関数 loadBasicInfo() 経由で localStorage を直接読まない。
  // マウント前は null、マウント後に loadBasicInfo() を 1度だけ呼んで以降は memo 値を返す。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const basicInfo = useMemo<BasicInfo | null>(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );
  // 面接で話せる要点を deterministic に派生するための canonical 入力。
  // 優先順位: 1. localStorage の StudentProfile → 2. wallHittingResult から派生 → 3. null。
  // self-analysis 未完了なら null になり、talkingPoints は [] になって Card は非描画。
  const studentProfile = useMemo<StudentProfile | null>(
    () =>
      isMounted
        ? getStudentProfileForFeature({
            wallHittingResult: loadWallHittingResult(),
          })
        : null,
    [isMounted],
  );
  // 「面接で話せる要点」リスト。AI を呼ばず deterministic に生成する。
  // /api/summarize に interviewPoints を戻さない方針のため、表示はここで責務を負う。
  const talkingPoints = useMemo(
    () => buildInterviewTalkingPoints(studentProfile),
    [studentProfile],
  );

  // STEP-UX-FIX-05-HUB-SUGGEST: 練習記録の有無で「次におすすめ」を出し分ける。
  // mount 前は null、mount 後に件数 (0 or N) を返す hydration セーフな derive。
  const recordCount = useMemo<number | null>(
    () => (isMounted ? getInterviewRecords().length : null),
    [isMounted],
  );
  const suggestion = useMemo(() => pickInterviewSuggestion(recordCount), [recordCount]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <PageHeader
        title="面接練習"
        description="AIが予想質問の作成や、対人練習後の振り返りをサポートします。"
      />

      <BasicInfoSummary basicInfo={basicInfo} />

      {/* mount 前は studentProfile=null → talkingPoints=[] → Card 非描画。
          mount 後は素材があれば Card が描画される。SSR/client で初期 render が
          一致するため hydration mismatch は起きない。 */}
      {isMounted && <InterviewTalkingPointsCard points={talkingPoints} />}

      <SuggestionCard suggestion={suggestion} />

      <div className="grid gap-4">
        {MENU_ITEMS.map((item) => (
          <InterviewMenuCard
            key={item.href}
            title={item.title}
            description={item.description}
            buttonLabel={item.buttonLabel}
            href={item.href}
          />
        ))}
      </div>
    </div>
  );
}

// ── 次におすすめ（STEP-UX-FIX-05-HUB-SUGGEST）─────────────────────
// 記録の有無で 2 通り。null（mount 前）は first-time 用の fallback と等価。

type Suggestion = {
  title: string;
  description: string;
  href: string;
  cta: string;
};

const INTERVIEW_SUGGESTION_QUESTIONS: Suggestion = {
  title: 'まず予想質問を作る',
  description: '志望校・活動内容から、面接で聞かれそうな質問を生成します。',
  href: '/interview/questions',
  cta: '予想質問を作る →',
};

const INTERVIEW_SUGGESTION_HISTORY: Suggestion = {
  title: '過去の練習を振り返る',
  description: 'これまでの記録から改善点を整理できます。',
  href: '/interview/history',
  cta: '記録を見る →',
};

function pickInterviewSuggestion(recordCount: number | null): Suggestion {
  if (recordCount === null || recordCount === 0) return INTERVIEW_SUGGESTION_QUESTIONS;
  return INTERVIEW_SUGGESTION_HISTORY;
}

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  return (
    <Card variant="soft" padding="md" className="mb-5 sm:mb-6">
      <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-2">
        次におすすめ
      </p>
      <p className="text-sm font-bold text-slate-800 mb-1">{suggestion.title}</p>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        {suggestion.description}
      </p>
      <LinkButton
        href={suggestion.href}
        variant="primary"
        size="md"
        className="w-full sm:w-auto"
      >
        {suggestion.cta}
      </LinkButton>
    </Card>
  );
}
