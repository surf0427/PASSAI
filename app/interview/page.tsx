'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { BasicInfo } from '@/types/basicInfo';
import type { StudentProfile } from '@/types/studentProfile';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { getStudentProfileForFeature } from '@/lib/getStudentProfileForFeature';
import { buildInterviewTalkingPoints } from '@/lib/buildInterviewTalkingPoints';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
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

const MENU_ITEMS = [
  {
    title: '予想質問を作る',
    description: '志望大学・活動内容をもとに、面接で聞かれそうな質問を作ります。',
    buttonLabel: '予想質問を作る',
    href: '/interview/questions',
  },
  {
    title: '練習結果を記録する',
    description: '先生や友達との面接練習後に、質問内容や回答を記録します。',
    buttonLabel: '練習結果を記録する',
    href: '/interview/record',
  },
  {
    title: '過去の練習記録を見る',
    description: 'これまでの面接練習の記録と改善点を確認します。',
    buttonLabel: '練習記録を見る',
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
