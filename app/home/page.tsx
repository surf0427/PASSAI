'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { loadActivityData } from '@/lib/activityStorage';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { loadAnalyzeState } from '@/lib/analyzeStorage';
import { loadMatchingInput, loadMatchingResult } from '@/lib/admissionMatchingStorage';
import { loadEssayProgress } from '@/lib/essayPracticeStorage';
import { loadDraft, loadReviewHistory } from '@/lib/statement/review/statementStorage';
import { getInterviewRecords } from '@/lib/interviewRecordStorage';
import { DiagnosisTypeCard } from '@/app/home/DiagnosisTypeCard';
import type { BasicInfo } from '@/types/basicInfo';

// ── 進捗ステータスの型 ─────────────────────────────────────────────

type ProgressStatus = 'not_started' | 'in_progress' | 'completed';

const PROGRESS_LABELS: Record<ProgressStatus, string> = {
  not_started: '未開始',
  in_progress: '途中',
  completed: '完了',
};

const PROGRESS_BADGE_STYLES: Record<ProgressStatus, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
};

function getButtonLabel(status: ProgressStatus): string {
  if (status === 'completed') return '編集する';
  if (status === 'in_progress') return '続きから';
  return 'はじめる';
}

// ── 進捗判定（機能ごと） ──────────────────────────────────────────
// ストレージキーの根拠は各 *Storage.ts ファイルを参照

function checkActivityStatus(): ProgressStatus {
  const data = loadActivityData(); // key: 'activityFormData'
  if (!data) return 'not_started';
  const hasAnyActivity =
    data.clubActivities.length > 0 ||
    data.volunteerActivities.length > 0 ||
    data.studyAbroadActivities.length > 0 ||
    data.researchActivities.length > 0 ||
    data.partTimeJobActivities.length > 0 ||
    data.certificationActivities.length > 0 ||
    data.contestActivities.length > 0 ||
    data.readingActivities.length > 0 ||
    data.hobbyActivities.length > 0 ||
    data.otherActivities.length > 0;
  if (!hasAnyActivity) return 'not_started';
  const wallHitting = loadWallHittingResult(); // key: 'wallHittingResult'
  return wallHitting ? 'completed' : 'in_progress';
}

function checkSelfAnalysisStatus(): ProgressStatus {
  const state = loadAnalyzeState(); // key: 'analyzeState'
  if (!state) return 'not_started';
  if (state.summary !== null) return 'completed';
  return 'in_progress';
}

function checkMatchingStatus(): ProgressStatus {
  const result = loadMatchingResult(); // key: 'admissionMatchingResult'
  if (result?.completed) return 'completed';
  const input = loadMatchingInput(); // key: 'admissionMatchingInput'
  return input ? 'in_progress' : 'not_started';
}

function checkEssayStatus(): ProgressStatus {
  const data = loadEssayProgress(); // key: 'essayPracticeData'
  if (!data) return 'not_started';
  if (data.hasReview) return 'completed';
  return 'in_progress';
}

function checkStatementStatus(): ProgressStatus {
  const history = loadReviewHistory(); // key: 'statementReviewHistory'
  if (history.length > 0) return 'completed';
  const draft = loadDraft(); // key: 'statementDraft'
  if (draft && draft.statementText.trim()) return 'in_progress';
  return 'not_started';
}

function checkInterviewStatus(): ProgressStatus {
  const records = getInterviewRecords(); // key: 'interview_records'
  if (records.length === 0) return 'not_started';
  const hasFeedback = records.some((r) => r.feedbackJson);
  return hasFeedback ? 'completed' : 'in_progress';
}

// ── 機能カードの定義 ──────────────────────────────────────────────

const FEATURES = [
  {
    title: '活動整理',
    description: '部活・ボランティア・資格など、これまでの活動を整理します。',
    href: '/input/activity',
  },
  {
    title: '自己分析',
    description: 'AIとの壁打ちを通じて、自分の強みや価値観を深掘りします。',
    href: '/self-analysis',
  },
  {
    title: '志望校マッチング',
    description: 'あなたのプロフィールに合った志望校を見つけます。',
    href: '/admission-matching',
  },
  {
    title: '志望理由書作成',
    description: 'AIのサポートで志望理由書を書き上げます。',
    href: '/statement',
  },
  {
    title: '小論文練習',
    description: 'テーマに沿って小論文を書き、AIからフィードバックをもらいます。',
    href: '/essay',
  },
  {
    title: '面接練習',
    description: '予想質問の作成や、練習結果の記録・振り返りをします。',
    href: '/interview',
  },
] as const;

// ── 今日やるべきこと ──────────────────────────────────────────────

const FEATURE_HINTS: Record<string, string> = {
  '/input/activity':     'あなたの経験を整理すると、自己分析や志望理由書が作りやすくなります。',
  '/self-analysis':      '自分の強みや価値観を言語化することで、志望理由書の核心が見えてきます。',
  '/admission-matching': 'あなたのプロフィールに合った志望校を確認しましょう。',
  '/statement':          '志望理由書の下書きを作って、AIのフィードバックを受けましょう。',
  '/essay':              '小論文の構成練習を通じて、論理的な表現力を鍛えましょう。',
  '/interview':          '予想質問を作って、面接本番に備えましょう。',
};

// completedでない最初の機能を返す。全完了の場合はnullを返す
function getNextFeature(statuses: Record<string, ProgressStatus>) {
  return FEATURES.find((feature) => statuses[feature.href] !== 'completed') ?? null;
}

// statusesからhrefに対応するステータスを取得する。未登録の場合はnot_startedを返す
function getStatus(statuses: Record<string, ProgressStatus>, href: string): ProgressStatus {
  return statuses[href] ?? 'not_started';
}

// ── ページ本体 ───────────────────────────────────────────────────

// SSR-stable mount flag（他ページと同形パターン）。
// hydration 後に true に切り替わり、storage 読み出しを post-hydration に揃える。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function HomePage() {
  const router = useRouter();

  // STEP-NAV-2: 旧 handleGoToSelfAnalysis（analyzeState.step を 'confirm' に
  // 戻してから /self-analysis に push する処理）は撤去。リセット責務は
  // /self-analysis hub のカード①「0から自己PRを書く」(startFresh) に集約済み。
  // /home → /self-analysis は hub に着地するだけで、開始 / 再開の選択は
  // hub のカードで行う。

  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  // localStorage を source of truth として useMemo で派生する。
  //   - SSR / 初回 client render は isMounted=false で null/空 を返し hydration セーフ
  //   - mount 後は loadBasicInfo() / 6 status checker を直接読む
  //   - Home 表示中の storage 変更は無く再評価不要のため version-counter 不要
  const basicInfo = useMemo<BasicInfo | null>(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );
  const statuses = useMemo<Record<string, ProgressStatus>>(() => {
    if (!isMounted) return {} as Record<string, ProgressStatus>;
    return {
      '/input/activity':     checkActivityStatus(),
      '/self-analysis':      checkSelfAnalysisStatus(),
      '/admission-matching': checkMatchingStatus(),
      '/statement':          checkStatementStatus(),
      '/essay':              checkEssayStatus(),
      '/interview':          checkInterviewStatus(),
    };
  }, [isMounted]);

  // 基本情報未入力なら /input/basic へ遷移させる genuine side-effect。
  // setState を含まないため react-hooks/set-state-in-effect は発火しない。
  // isMounted=true で basicInfo=null のときだけ replace を発火し、replace 後は
  // 本コンポーネントが unmount されるため effect 再実行による replay リスクはない。
  useEffect(() => {
    if (isMounted && !basicInfo) {
      router.replace('/input/basic');
    }
  }, [isMounted, basicInfo, router]);

  if (!isMounted) return null;
  if (!basicInfo) return null; // mount 済 + 未入力。上記 effect で /input/basic へ replace 中

  const firstPreference = basicInfo.preferences[0];
  const nextFeature = getNextFeature(statuses);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">

      {/* ユーザー情報 */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          こんにちは、{basicInfo.name}さん
        </h1>
        {firstPreference && (
          <p className="text-gray-500 text-sm mb-4">
            第一志望：{firstPreference.university}　{firstPreference.faculty}
          </p>
        )}
        <p className="text-gray-600 text-sm leading-relaxed mb-4">
          総合型選抜（AO・推薦）の対策をAIがサポートします。<br />
          活動整理から志望理由書・面接対策まで、一歩ずつ進めましょう。
        </p>
        <Link
          href="/input/basic"
          className="inline-block border border-gray-300 hover:border-gray-400 text-gray-600 hover:text-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          基本情報を編集
        </Link>
      </div>

      {/* 診断タイプ（ある場合）／無ければ診断への誘導 */}
      <DiagnosisTypeCard />

      {/* 今日やるべきこと
          active 時は <Card variant="soft"> で「やさしい案内」感を出す。
          完了時は緑系の達成色を残すため raw <div> を維持（Card primitive に
          green variant は無く、デザインシステム的にも完了表現の色は別途議論）。 */}
      {nextFeature ? (
        <Card variant="soft" padding="md" className="mb-8">
          <p className="text-xs font-semibold text-brand-600 mb-2">今日やるべきこと</p>
          <p className="text-base font-bold text-gray-800 mb-1">
            まずは「{nextFeature.title}」から始めましょう。
          </p>
          <p className="text-sm text-gray-600 mb-4">
            {FEATURE_HINTS[nextFeature.href]}
          </p>
          <LinkButton
            href={nextFeature.href}
            variant="primary"
            size="md"
          >
            {getButtonLabel(getStatus(statuses, nextFeature.href))}
          </LinkButton>
        </Card>
      ) : (
        <div className="mb-8 bg-green-50 border border-green-200 rounded-xl p-6">
          <p className="text-xs font-semibold text-green-600 mb-2">今日やるべきこと</p>
          <p className="text-base font-bold text-gray-800 mb-1">
            すべての機能が完了しています！おつかれさまでした。
          </p>
          <p className="text-sm text-gray-600 mb-4">
            内容を見直したい場合は、各機能から編集できます。
          </p>
          <Link
            href="/input/activity"
            className="inline-block border border-green-600 text-green-700 hover:bg-green-100 font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            活動整理を見直す
          </Link>
        </div>
      )}

      {/* 機能カード一覧（PASSAI のメイン 6 機能。順序が学習フロー） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FEATURES.map((feature) => {
          const status = getStatus(statuses, feature.href);
          return (
            <Card
              key={feature.href}
              variant="default"
              padding="md"
              className="flex flex-col gap-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h2 className="text-base font-bold text-gray-800">
                    {feature.title}
                  </h2>
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${PROGRESS_BADGE_STYLES[status]}`}>
                    {PROGRESS_LABELS[status]}
                  </span>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {feature.description}
                </p>
              </div>
              <div className="mt-auto pt-1">
                {/* STEP-NAV-2: 全 feature とも純粋な遷移になったので LinkButton に統一。
                    self-analysis だけ Button + onClick だったのは旧 reset 側効を行うため
                    の分岐で、責務を hub に移したため不要になった。 */}
                <LinkButton
                  href={feature.href}
                  variant="primary"
                  size="md"
                >
                  {getButtonLabel(status)}
                </LinkButton>
              </div>
            </Card>
          );
        })}
      </div>

      {/* マイページ（学習の積み重ね / スコア推移の振り返り）
          配置方針: メイン 6 機能 grid と チューター section の間に、同形の soft Card
          で並列配置。マイページは「進捗を見る」、チューターは「詰まった時に相談」と
          責務が分かれた支援機能どうしなので、視覚的にも同じ帯にまとめる。
          メイン grid の順序・内容は変更しない（学習フローを壊さないため）。 */}
      <section className="mt-10">
        <p className="text-xs text-gray-500 mb-3 px-1">学習の振り返り</p>
        <Card variant="soft" padding="md">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-base font-bold text-gray-800 mb-1.5">マイページ</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                学習の積み重ねとスコア推移を見る
              </p>
            </div>
            <div className="shrink-0 sm:self-end">
              <LinkButton href="/mypage" variant="outline" size="md">
                マイページを見る
              </LinkButton>
            </div>
          </div>
        </Card>
      </section>

      {/* 受験チューターAI（詰まった時の整理役、メイン 6 機能とは別の支援的役割）
          配置方針: メイン機能 grid の下に soft Card で分離。Header の nav には
          載せない（app/components/Header.tsx の方針: 上部ナビは Home / 基本情報のみ）。
          視覚的に primary CTA を避けるため LinkButton variant='outline' を採用。 */}
      <section className="mt-10">
        <p className="text-xs text-gray-500 mb-3 px-1">詰まった時の整理</p>
        <Card variant="soft" padding="md">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-base font-bold text-gray-800 mb-1.5">受験チューターAI</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                志望理由書・面接・不安など、今引っかかっていることを軽く整理して、次に何を進めるか一緒に見ます。
              </p>
            </div>
            <div className="shrink-0 sm:self-end">
              <LinkButton href="/tutor" variant="outline" size="md">
                整理してみる
              </LinkButton>
            </div>
          </div>
        </Card>
      </section>

    </div>
  );
}
