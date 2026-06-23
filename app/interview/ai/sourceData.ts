'use client';

// STEP-INTERVIEW-AI-TYPE: 面接タイプ別の元データ取得（canonical localStorage から）。
//
// 2026-06 方針:
//   - self_analysis: 自己分析 + 活動整理を統合（活動整理は自己分析の一部という PASSAI 思想）。
//   - statement / essay: それぞれ最新データ。
//   - free（本番モード）/ pressure（圧迫面接）: データ連携なし（常に開始可・誘導不要）。
//   - activity / matching は廃止（self_analysis へ統合 / 価値が弱いため削除）。
//
// 方針:
//   - 元データは localStorage が canonical（既存 interview-feedback と同じく client 集約）。
//   - データが無い data-linked タイプ（self_analysis/statement/essay）は available=false + 誘導。
//   - sourceContext は session.target_ref.sourceContext に保存され、server 側の質問/評価生成で使う。
//   - 実在する storage loader のみ使用。未確定の形は defensive に（optional chaining / fallback ''）。

import type { InterviewType } from '@/lib/interviewAi/interviewTypes';
import { loadWallHittingResult } from '@/lib/wallHittingStorage';
import { loadActivityData } from '@/lib/activityStorage';
import { loadDraft, loadReviewHistory } from '@/lib/statement/review/statementStorage';
import { loadEssayWorkspaces } from '@/lib/essayWorkspaceStorage';
import { getInterviewRecords } from '@/lib/interviewRecordStorage';

const MAX_CONTEXT_CHARS = 6000;

export type SourceGuidance = { message: string; ctaLabel: string; href: string };

export type ResolvedSource =
  | {
      available: true;
      // 本番モード（free）は横断集約で sourceType=null（特定 1 機能ではない）。他は機能種別。
      sourceType: InterviewType | null;
      sourceId: string | null;
      sourceContext: string;
    }
  | { available: false; guidance: SourceGuidance };

// データ連携が必要なタイプのみ誘導を持つ（free / pressure は常に available）。
const GUIDANCE: Record<'self_analysis' | 'statement' | 'essay', SourceGuidance> = {
  self_analysis: {
    message:
      '自己分析データがまだありません。先に自己分析を完了すると、あなた専用の面接練習ができます。',
    ctaLabel: '自己分析を始める',
    href: '/self-analysis',
  },
  statement: {
    message:
      '志望理由書データがまだありません。先に志望理由書を作成すると、内容に基づいた面接練習ができます。',
    ctaLabel: '志望理由書を作成する',
    href: '/statement',
  },
  essay: {
    message:
      '小論文データがまだありません。先に小論文に取り組むと、扱ったテーマで面接練習ができます。',
    ctaLabel: '小論文を始める',
    href: '/essay-practice',
  },
};

function clip(s: string): string {
  const t = s.trim();
  return t.length > MAX_CONTEXT_CHARS ? `${t.slice(0, MAX_CONTEXT_CHARS)}…` : t;
}

function list(label: string, items: unknown): string {
  if (!Array.isArray(items)) return '';
  const xs = items.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return xs.length ? `${label}: ${xs.join(' / ')}` : '';
}

function joinNonEmpty(lines: string[]): string {
  return lines.filter((l) => l && l.trim() !== '').join('\n');
}

// オブジェクトの string 値（短いもの）を拾って 1 行に。activity の個別 item 形に依存しない防御的抽出。
function stringFieldsOf(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const vals: string[] = [];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() && v.length <= 400) vals.push(v.trim());
  }
  return vals.join(' / ');
}

// 活動整理（ActivityData）を防御的にテキスト化する。
function activityLinesFrom(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const lines: string[] = [];
  for (const arr of Object.values(data as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const s = stringFieldsOf(item);
      if (s) lines.push(`- ${s}`);
    }
  }
  return lines;
}

// ⭐ 自己分析ベース: 自己分析 + 活動整理を統合。
function resolveSelfAnalysis(): ResolvedSource {
  const r = loadWallHittingResult();
  if (!r || (!r.summary && (r.strengths?.length ?? 0) === 0)) {
    return { available: false, guidance: GUIDANCE.self_analysis };
  }
  const activityLines = activityLinesFrom(loadActivityData());
  const ctx = joinNonEmpty([
    r.summary ? `自己分析の要約: ${r.summary}` : '',
    list('強み', r.strengths),
    list('弱み', r.weaknesses),
    list('将来への接続', r.futureConnections),
    list('深めたい問い', r.questions),
    activityLines.length ? `活動経験:\n${activityLines.join('\n')}` : '',
  ]);
  return { available: true, sourceType: 'self_analysis', sourceId: null, sourceContext: clip(ctx) };
}

// ⭐ 志望理由書ベース。
function resolveStatement(): ResolvedSource {
  const history = loadReviewHistory();
  const latest = history[0];
  const draft = loadDraft();
  const essay = (latest?.essay ?? '').trim() || (draft?.statementText ?? '').trim();
  if (!essay) return { available: false, guidance: GUIDANCE.statement };
  const uni = latest?.university || draft?.university || '';
  const fac = latest?.faculty || draft?.faculty || '';
  const ctx = joinNonEmpty([
    uni || fac ? `志望: ${[uni, fac].filter(Boolean).join(' ')}` : '',
    `志望理由書本文:\n${essay}`,
  ]);
  return {
    available: true,
    sourceType: 'statement',
    sourceId: latest?.id ?? null,
    sourceContext: clip(ctx),
  };
}

// 小論文の最新 AI 添削結果（評価）を防御的にテキスト化する。
//   - reviews は append-only（push のみ。最新は末尾＝reviews.at(-1)。invariant I3: body は
//     reviews.at(-1).essayBodySnapshot と一致）。本文と整合する「最新の評価」として末尾を使う
//     （reviews[0] は最古の初回添削なので使わない）。
//   - breakdown（5 軸スコア）と improvement（最重要改善点）を載せ、面接官が AI 採点結果を踏まえて
//     「論理性が弱い」「具体例が不足」等の口頭試問をできるようにする。
//   - 形は ReviewEntry（types/essay.ts）。ただし旧データ / parse 揺れに備えて防御的に読む。
function essayReviewLines(reviews: unknown): string {
  if (!Array.isArray(reviews) || reviews.length === 0) return '';
  const latest = reviews[reviews.length - 1];
  if (!latest || typeof latest !== 'object') return '';
  const r = latest as Record<string, unknown>;
  const lines: string[] = [];
  // breakdown: { label, score }[] を「論理構造: 3 / 具体性: 2 …」の 1 行に集約。
  if (Array.isArray(r.breakdown)) {
    const axes = r.breakdown
      .filter(
        (b): b is { label: string; score: number } =>
          !!b &&
          typeof b === 'object' &&
          typeof (b as { label?: unknown }).label === 'string' &&
          typeof (b as { score?: unknown }).score === 'number',
      )
      .map((b) => `${b.label}: ${b.score}`);
    if (axes.length) lines.push(`AI採点（5軸スコア）: ${axes.join(' / ')}`);
  }
  const improvement =
    typeof r.improvement === 'string' ? r.improvement.trim() : '';
  if (improvement) lines.push(`AIが指摘した最重要改善点: ${improvement}`);
  return joinNonEmpty(lines);
}

// 📝 小論文ベース。
function resolveEssay(): ResolvedSource {
  const workspaces = loadEssayWorkspaces();
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return { available: false, guidance: GUIDANCE.essay };
  }
  const latest = [...workspaces].sort((a, b) =>
    (b.updatedAt ?? '') < (a.updatedAt ?? '') ? -1 : 1,
  )[0];
  const theme = latest.theme?.text ?? '';
  const mini = latest.mini
    ? joinNonEmpty([
        latest.mini.conclusion ? `結論: ${latest.mini.conclusion}` : '',
        latest.mini.reasonOne ? `理由1: ${latest.mini.reasonOne}` : '',
        latest.mini.reasonTwo ? `理由2: ${latest.mini.reasonTwo}` : '',
      ])
    : '';
  const body = (latest.body ?? '').trim();
  // 最新 AI 添削（評価結果）。breakdown / improvement を口頭試問に使えるよう要約する。
  const reviewSummary = essayReviewLines(latest.reviews);
  if (!theme && !mini && !body && !reviewSummary) {
    return { available: false, guidance: GUIDANCE.essay };
  }
  // 評価結果（短く高価値）は本文（長文）より前に置き、clip による末尾切り捨てで失われないようにする。
  const ctx = joinNonEmpty([
    theme ? `小論文テーマ: ${theme}` : '',
    mini,
    reviewSummary ? `AI添削の評価結果:\n${reviewSummary}` : '',
    body ? `本文:\n${body}` : '',
  ]);
  return { available: true, sourceType: 'essay', sourceId: latest.id ?? null, sourceContext: clip(ctx) };
}

// 🎯 本番モード（free）: PASSAI 内の各機能の記録を横断的に集約する総合モード。
//   - 「完全連携」ではなく「利用可能な記録をできる範囲で参照する」。
//   - 記録が不足していても常に開始可能（available:true / 誘導しない）。記録ゼロなら一般面接。
//   - interview_type は 'free' のまま。source_type / source_id は null（特定 1 機能ではない）。
function resolveFree(): ResolvedSource {
  const sections: string[] = [];

  // 自己分析
  const sa = loadWallHittingResult();
  if (sa && (sa.summary || (sa.strengths?.length ?? 0) > 0)) {
    sections.push(
      joinNonEmpty([
        sa.summary ? `【自己分析】${sa.summary}` : '【自己分析】',
        list('強み', sa.strengths),
        list('弱み', sa.weaknesses),
        list('将来への接続', sa.futureConnections),
      ]),
    );
  }

  // 活動整理
  const actLines = activityLinesFrom(loadActivityData());
  if (actLines.length) sections.push(`【活動経験】\n${actLines.join('\n')}`);

  // 志望理由書
  const history = loadReviewHistory();
  const latest = history[0];
  const draft = loadDraft();
  const statementText = (latest?.essay ?? '').trim() || (draft?.statementText ?? '').trim();
  if (statementText) sections.push(`【志望理由書】\n${statementText}`);

  // 小論文
  const workspaces = loadEssayWorkspaces();
  if (Array.isArray(workspaces) && workspaces.length > 0) {
    const ws = [...workspaces].sort((a, b) =>
      (b.updatedAt ?? '') < (a.updatedAt ?? '') ? -1 : 1,
    )[0];
    const theme = ws.theme?.text ?? '';
    const body = (ws.body ?? '').trim();
    if (theme || body) {
      sections.push(joinNonEmpty([theme ? `【小論文テーマ】${theme}` : '', body ? `本文:\n${body}` : '']));
    }
  }

  // 過去の面接練習記録（直近 3 件・弱かった点を中心に）
  const records = getInterviewRecords();
  if (Array.isArray(records) && records.length > 0) {
    const recLines = records
      .slice(0, 3)
      .map((r) => {
        const q = (r.mainQuestion ?? '').trim();
        const weak = (r.whatWentWrong ?? '').trim();
        const summary = (r.improvementSummary ?? '').trim().slice(0, 200);
        return `- ${[q && `質問:${q}`, weak && `課題:${weak}`, summary && `改善:${summary}`]
          .filter(Boolean)
          .join(' / ')}`;
      })
      .filter((l) => l !== '- ');
    if (recLines.length) sections.push(`【過去の面接練習で弱かった点】\n${recLines.join('\n')}`);
  }

  const ctx = clip(sections.filter((s) => s && s.trim() !== '').join('\n\n'));
  // 記録ゼロでも available:true（一般的な総合型選抜面接として開始）。
  return { available: true, sourceType: null, sourceId: null, sourceContext: ctx };
}

/**
 * 選択された interview_type に対して元データを解決する。
 * - free（本番モード）: PASSAI 内の記録を横断集約。常に available（記録ゼロでも開始可）。
 * - pressure（圧迫面接）: データ連携なし。常に available。
 * - data-linked（self_analysis/statement/essay）はデータが無ければ available:false + guidance。
 */
export function resolveSource(type: InterviewType): ResolvedSource {
  switch (type) {
    case 'self_analysis':
      return resolveSelfAnalysis();
    case 'statement':
      return resolveStatement();
    case 'essay':
      return resolveEssay();
    case 'free':
      return resolveFree();
    case 'pressure':
      return { available: true, sourceType: 'pressure', sourceId: null, sourceContext: '' };
  }
}
