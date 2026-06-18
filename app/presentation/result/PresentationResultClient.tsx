'use client';

// プレゼン結果画面（評価表示 + signed URL 再生）。発表後 Q&A UI は今回は含めない。
//
// データ取得は client 直読み（RLS owner SELECT で本人の attempt/result のみ取得可能）。
// 動画は GET /api/presentation/attempt/[id]/signed-url で短 TTL の署名 URL を取得して再生。

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';
import { AlertBox } from '@/components/ui/AlertBox';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

import { PresentationPremiumGate } from '../PresentationPremiumGate';
import {
  parseUniversityInfo,
  UniversityInfoCard,
  type UniversityInfo,
} from '../universityInfoView';
import { PostPresentationQa } from './PostPresentationQa';
import { PastPresentationQaHistory } from './PastPresentationQaHistory';

type Level = 'weak' | 'normal' | 'strong';

const CATEGORY_ORDER: { key: string; label: string }[] = [
  { key: 'composition', label: '構成力' },
  { key: 'persuasion', label: '説得力' },
  { key: 'concreteness', label: '具体性' },
  { key: 'clarity', label: 'わかりやすさ' },
  { key: 'timeManagement', label: '時間配分' },
  { key: 'completeness', label: '完成度' },
];

const LEVEL_LABEL: Record<Level, string> = {
  weak: '要改善',
  normal: '標準',
  strong: '良い',
};
const LEVEL_CLASS: Record<Level, string> = {
  weak: 'bg-amber-100 text-amber-800',
  normal: 'bg-slate-100 text-slate-700',
  strong: 'bg-emerald-100 text-emerald-800',
};

function isLevel(v: unknown): v is Level {
  return v === 'weak' || v === 'normal' || v === 'strong';
}
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

type Feedback = {
  categories: Record<string, unknown>;
  overallComment: string;
  goodPoints: string[];
  improvements: string[];
  nextPractice: string[];
  materialFeedback: string[];
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'pending'; sessionId: string } // 評価作成中 / 未完了
  | {
      kind: 'ready';
      feedback: Feedback;
      transcript: string;
      university: UniversityInfo | null;
      themeMode: string;
      conditions: string[];
      questions: string[];
    };

export function PresentationResultClient() {
  const searchParams = useSearchParams();
  const attemptId = searchParams.get('attemptId') ?? '';

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  // 録画動画が TTL（90日）で削除済みか。true なら再生欄に「保存期間終了」を表示する。
  const [videoDeleted, setVideoDeleted] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!attemptId) return;

    async function load() {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        if (!cancelledRef.current) setState({ kind: 'not-found' });
        return;
      }

      // 1. attempt（RLS owner SELECT → 本人の行のみ）。
      const { data: attempt, error: attemptErr } = await supabase
        .from('presentation_attempts')
        .select('id, session_id, status, transcript, video_deleted_at')
        .eq('id', attemptId)
        .maybeSingle();
      if (cancelledRef.current) return;
      if (attemptErr || !attempt) {
        setState({ kind: 'not-found' });
        return;
      }

      // 2. result（1 attempt 1 result）。
      const { data: result } = await supabase
        .from('presentation_results')
        .select('feedback, categories')
        .eq('attempt_id', attemptId)
        .maybeSingle();
      if (cancelledRef.current) return;

      if (!result || attempt.status !== 'evaluated') {
        // 評価作成中 / 未完了。record へ戻れるよう session_id を渡す。
        setState({ kind: 'pending', sessionId: attempt.session_id ?? '' });
        return;
      }

      // 2b. 想定大学情報（session から。後方互換: 無ければ null）。
      const { data: session } = await supabase
        .from('presentation_sessions')
        .select(
          'university_name, faculty_name, department_name, admission_type, presentation_format, presentation_limit_sec, university_notes, theme_mode, generated_conditions, generated_questions',
        )
        .eq('id', attempt.session_id)
        .maybeSingle();
      if (cancelledRef.current) return;
      const university = parseUniversityInfo(session ?? null);
      const themeMode = typeof session?.theme_mode === 'string' ? session.theme_mode : 'manual';
      const conditions = Array.isArray(session?.generated_conditions)
        ? (session.generated_conditions as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : [];
      const questions = Array.isArray(session?.generated_questions)
        ? (session.generated_questions as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : [];

      const fb = (result.feedback ?? {}) as Record<string, unknown>;
      const feedback: Feedback = {
        categories:
          fb.categories && typeof fb.categories === 'object'
            ? (fb.categories as Record<string, unknown>)
            : {},
        overallComment:
          typeof fb.overallComment === 'string' ? fb.overallComment : '',
        goodPoints: toStringArray(fb.goodPoints),
        improvements: toStringArray(fb.improvements),
        nextPractice: toStringArray(fb.nextPractice),
        materialFeedback: toStringArray(fb.materialFeedback),
      };
      setState({
        kind: 'ready',
        feedback,
        transcript:
          typeof attempt.transcript === 'string' ? attempt.transcript : '',
        university,
        themeMode,
        conditions,
        questions,
      });

      // 3. 録画動画が TTL 削除済みなら signed URL は取得しない（評価・文字起こしは表示継続）。
      if (attempt.video_deleted_at) {
        setVideoDeleted(true);
        return;
      }

      // 4. 動画の signed URL（失敗しても評価は表示する）。
      try {
        const res = await fetch(
          `/api/presentation/attempt/${encodeURIComponent(attemptId)}/signed-url`,
        );
        if (cancelledRef.current) return;
        if (res.ok) {
          const json = (await res.json()) as { signedUrl?: string };
          if (json.signedUrl) setSignedUrl(json.signedUrl);
          else setVideoError(true);
        } else {
          setVideoError(true);
        }
      } catch {
        if (!cancelledRef.current) setVideoError(true);
      }
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [attemptId]);

  // attemptId 不足
  if (!attemptId) {
    return (
      <Card padding="lg" className="space-y-4">
        <AlertBox variant="error">
          評価が指定されていません。テーマ設定から、または履歴からやり直してください。
        </AlertBox>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/presentation/setup" variant="primary">
            テーマ設定へ
          </LinkButton>
          <LinkButton href="/presentation" variant="secondary">
            プレゼン練習トップへ
          </LinkButton>
        </div>
      </Card>
    );
  }

  return (
    <PresentationPremiumGate>
      <ResultBody
        state={state}
        signedUrl={signedUrl}
        videoError={videoError}
        videoDeleted={videoDeleted}
        attemptId={attemptId}
      />
    </PresentationPremiumGate>
  );
}

function ResultBody({
  state,
  signedUrl,
  videoError,
  videoDeleted,
  attemptId,
}: {
  state: LoadState;
  signedUrl: string | null;
  videoError: boolean;
  videoDeleted: boolean;
  attemptId: string;
}) {
  if (state.kind === 'loading') {
    return <p className="text-sm text-slate-500">読み込み中…</p>;
  }

  if (state.kind === 'not-found') {
    return (
      <Card padding="lg" className="space-y-4">
        <AlertBox variant="error">評価が見つかりませんでした。</AlertBox>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/presentation/setup" variant="primary">
            新しく練習する
          </LinkButton>
          <LinkButton href="/presentation" variant="secondary">
            プレゼン練習トップへ
          </LinkButton>
        </div>
      </Card>
    );
  }

  if (state.kind === 'pending') {
    const recordHref = state.sessionId
      ? `/presentation/record?sessionId=${encodeURIComponent(state.sessionId)}`
      : '/presentation/setup';
    return (
      <Card padding="lg" className="space-y-4">
        <AlertBox variant="info">
          AI評価は作成中、または未完了です。録画画面に戻って評価を完了してください。
        </AlertBox>
        <div className="flex flex-wrap gap-3">
          <LinkButton href={recordHref} variant="primary">
            録画画面に戻る
          </LinkButton>
          <LinkButton href="/presentation" variant="secondary">
            プレゼン練習トップへ
          </LinkButton>
        </div>
      </Card>
    );
  }

  const { feedback, transcript, university, themeMode, conditions, questions } =
    state;
  const isGenerated = themeMode === 'generated';

  return (
    <div className="space-y-4">
      {/* 想定大学情報（university_name がある場合のみ） */}
      {university && (
        <Card padding="lg">
          <UniversityInfoCard info={university} />
        </Card>
      )}

      {/* AI即興テーマの発表条件 / 想定質問（generated のみ） */}
      {isGenerated && (conditions.length > 0 || questions.length > 0) && (
        <Card padding="lg" className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">テーマの発表条件</h2>
          {conditions.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-800">発表条件</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                {conditions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {questions.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-800">想定質問</h3>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
                {questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      )}

      {/* 動画再生 */}
      <Card padding="lg" className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">録画の見返し</h2>
        {videoDeleted ? (
          <AlertBox variant="info">
            録画動画の保存期間が終了しました。AI評価と文字起こしは引き続き確認できます。
          </AlertBox>
        ) : signedUrl ? (
          <div className="overflow-hidden rounded-lg bg-black aspect-video">
            <video src={signedUrl} controls playsInline className="h-full w-full" />
          </div>
        ) : videoError ? (
          <AlertBox variant="warning">動画の読み込みに失敗しました。</AlertBox>
        ) : (
          <p className="text-sm text-slate-500">動画を読み込んでいます…</p>
        )}
      </Card>

      {/* カテゴリ評価 */}
      <Card padding="lg" className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">AI評価</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CATEGORY_ORDER.map(({ key, label }) => {
            const raw = feedback.categories[key];
            const level: Level = isLevel(raw) ? raw : 'normal';
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
              >
                <span className="text-sm text-slate-700">{label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_CLASS[level]}`}
                >
                  {LEVEL_LABEL[level]}
                </span>
              </div>
            );
          })}
        </div>

        {/* 資料との整合性（資料を添付した評価のみ） */}
        {isLevel(feedback.categories.materialConsistency) && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-sm text-slate-700">資料との整合性</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                LEVEL_CLASS[feedback.categories.materialConsistency as Level]
              }`}
            >
              {LEVEL_LABEL[feedback.categories.materialConsistency as Level]}
            </span>
          </div>
        )}

        {feedback.overallComment && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">総評</h3>
            <p className="text-sm leading-relaxed text-slate-700">
              {feedback.overallComment}
            </p>
          </div>
        )}

        <FeedbackList title="良かった点" items={feedback.goodPoints} />
        <FeedbackList title="改善点" items={feedback.improvements} />
        <FeedbackList title="次に練習すること" items={feedback.nextPractice} />
        <FeedbackList title="資料に関する改善提案" items={feedback.materialFeedback} />
      </Card>

      {/* 文字起こし */}
      {transcript && (
        <Card padding="lg" className="space-y-2">
          <h2 className="text-lg font-bold text-slate-900">文字起こし</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {transcript}
          </p>
        </Card>
      )}

      {/* 発表後Q&A練習（評価完了済みの attempt のみ。今セッションのライブ Q&A） */}
      <PostPresentationQa attemptId={attemptId} />

      {/* 過去の発表後Q&A履歴（DB 永続化分。新しい順・折りたたみ。0 件なら描画しない） */}
      <PastPresentationQaHistory attemptId={attemptId} />
    </div>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-800">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
