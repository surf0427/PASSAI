'use client';

// 過去の発表後 Q&A 履歴（DB 永続化分）。result 画面で PostPresentationQa（今セッションの
// ライブ Q&A）とは別に、これまで保存された Q&A 交換を新しい順に折りたたみ表示する。
//
// データ取得は client 直読み（RLS owner SELECT で本人の attempt 分のみ）。書込はしない。

import { useEffect, useRef, useState } from 'react';

import { getBrowserSupabaseClient } from '@/lib/supabase/browserClient';
import { Card } from '@/components/ui/Card';

type Review = {
  goodPoints: string[];
  improvements: string[];
  modelAnswerDirection: string;
};

type Item = {
  id: string;
  question: string;
  answerText: string;
  review: Review;
  createdAt: string;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: Item[] };

function toStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

function parseReview(v: unknown): Review {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    goodPoints: toStringArray(o.goodPoints),
    improvements: toStringArray(o.improvements),
    modelAnswerDirection:
      typeof o.modelAnswerDirection === 'string' ? o.modelAnswerDirection : '',
  };
}

export function PastPresentationQaHistory({ attemptId }: { attemptId: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!attemptId) return;

    async function load() {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        if (!cancelledRef.current) setState({ kind: 'error' });
        return;
      }
      const { data, error } = await supabase
        .from('presentation_qa_reviews')
        .select('id, question, answer_text, review, created_at')
        .eq('attempt_id', attemptId)
        .order('created_at', { ascending: false });
      if (cancelledRef.current) return;
      if (error) {
        setState({ kind: 'error' });
        return;
      }
      const items: Item[] = (data ?? []).map((r) => ({
        id: r.id as string,
        question: typeof r.question === 'string' ? r.question : '',
        answerText: typeof r.answer_text === 'string' ? r.answer_text : '',
        review: parseReview(r.review),
        createdAt: (r.created_at as string) ?? '',
      }));
      setState({ kind: 'ready', items });
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [attemptId]);

  // 取得失敗・読み込み中・0 件は何も描画しない（ライブ Q&A セクションを邪魔しない）。
  if (state.kind !== 'ready' || state.items.length === 0) return null;

  return (
    <Card padding="lg" className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-slate-900">
          過去のQ&A履歴
          <span className="ml-2 text-sm font-normal text-slate-500">
            {state.items.length}件
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          これまでに保存された質問と回答・フィードバックです（新しい順）。
        </p>
      </div>

      <div className="space-y-2">
        {state.items.map((item) => (
          <details
            key={item.id}
            className="rounded-lg border border-slate-200 [&_summary]:cursor-pointer"
          >
            <summary className="px-3 py-2 text-sm font-semibold text-slate-800">
              {item.question}
            </summary>
            <div className="space-y-2 px-3 pb-3">
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                <span className="text-slate-500">あなたの回答: </span>
                {item.answerText}
              </p>
              <div className="space-y-2 rounded-md bg-slate-50 p-3">
                <QaList title="良かった点" items={item.review.goodPoints} />
                <QaList title="改善点" items={item.review.improvements} />
                {item.review.modelAnswerDirection && (
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      模範回答の方向性
                    </p>
                    <p className="text-sm leading-relaxed text-slate-700">
                      {item.review.modelAnswerDirection}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

function QaList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-800">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm leading-relaxed text-slate-700">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
