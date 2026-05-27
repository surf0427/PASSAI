// EssayWorkspace の mutation 純関数群（STEP A 新規）。
//
// 役割:
//   workspace を受け取り、不変条件（I1〜I7）を保ったまま新しい workspace を返す
//   純関数を提供する。localStorage には触らない（保存は呼び出し側が
//   essayWorkspaceStorage.upsertEssayWorkspace 経由で行う）。
//
// STEP A で実装するもの:
//   - appendInitialReview: 初回 review を append
// STEP B で追加するもの:
//   - createInitialWorkspace: 新規 workspace 構築（dual-write 用）
// STEP E で追加するもの:
//   - startImprovement         : improvementInProgress を新規作成
//   - abandonImprovement       : improvementInProgress を null に戻す
//   - updateImprovementAnswers : answers のみ更新（length pair invariant 保証）
// STEP F で追加するもの:
//   - attachImprovementSummary : AI 改善方針（ImprovementSummary）を保存
// STEP G で追加するもの:
//   - updateRewriteDraft       : rewriteDraft autosave
//   - submitRewriteReview      : **最大危険点**。再添削成功時の集中 transaction
//     （reviews.push + body 更新 + improvementInProgress = null を atomic に行う）
// Phase 2 STEP J で追加するもの:
//   - updateTarget / updateTheme / updateMini / updateBody : フィールド単体 autosave
//   - startSparring / updateSparringAnswers / abandonSparring : 壁打ちセッション
//
// 関連:
//   - 型: types/essay.ts
//   - 定数: lib/essayWorkspaceStorage.ts
//   - invariant: docs/essay/essay_workspace_invariants.md

import {
  MAX_REVIEWS_PER_WORKSPACE,
  generateWorkspaceId,
} from '@/lib/essayWorkspaceStorage';
import type { ReviewResult } from '@/lib/essayPracticeStorage';
import type {
  BreakdownAxis,
  EssayWorkspace,
  ImprovementInProgress,
  ImprovementSummary,
  ImprovementWork,
  ReviewEntry,
  SparringSession,
} from '@/types/essay';

// 初回 review（添削成功）を workspace に append する。
//
// 不変条件:
//   I1: reviews は push のみ。spread で末尾追加し、pop/splice/sort は使わない。
//   I2: ReviewEntry.essayBodySnapshot は引数 body を保存（時系列同期）。
//   I3: workspace.body も同じ body に更新（latest snapshot との一致）。
//   I7: reviews.length > 20 なら先頭から drop（slice(-20)）。
//
// throw 条件: なし（防御的に動く）。
//
// 注意:
//   sourceIssueId は付けない（初回 review のため undefined）。
//   再添削（STEP G の submitRewriteReview）では sourceIssueId を付与する。
export function appendInitialReview(
  workspace: EssayWorkspace,
  reviewResult: ReviewResult,
  body: string,
): EssayWorkspace {
  const now = new Date().toISOString();

  const newEntry: ReviewEntry = {
    totalScore: reviewResult.totalScore,
    verdict: reviewResult.verdict,
    breakdown: reviewResult.breakdown,
    improvement: reviewResult.improvement,
    goodPoints: reviewResult.goodPoints,
    weakPoints: reviewResult.weakPoints,
    createdAt: now,
    essayBodySnapshot: body,
  };

  const appended = [...workspace.reviews, newEntry];
  const reviews =
    appended.length > MAX_REVIEWS_PER_WORKSPACE
      ? appended.slice(-MAX_REVIEWS_PER_WORKSPACE)
      : appended;

  return {
    ...workspace,
    reviews,
    body,
    updatedAt: now,
  };
}

// 新規 EssayWorkspace を構築する（reviews 空 / improvementInProgress null）。
//
// STEP B での想定使用箇所:
//   /essay-practice の添削成功時に「現セッションに対応する workspace が無い」
//   状態から初回 review を保存する経路。
//
// 引数の target / theme / mini / body は呼び出し側がそのとき手元にあるものを渡す。
// 後続の appendInitialReview で reviews が append され、body も保証される。
//
// STEP D で /essay/improve hub から workspace を作るときもここを使う想定。
export function createInitialWorkspace(args: {
  target: EssayWorkspace['target'];
  theme: EssayWorkspace['theme'];
  mini: EssayWorkspace['mini'];
  body: string;
}): EssayWorkspace {
  const now = new Date().toISOString();
  return {
    id: generateWorkspaceId(),
    createdAt: now,
    updatedAt: now,
    target: args.target,
    theme: args.theme,
    mini: args.mini,
    body: args.body,
    reviews: [],
    improvementInProgress: null,
    sparring: null, // Phase 2 で追加。初期は未開始
  };
}

// 改善ワーク 1 個（issue 単位）を開始する。
// 責務分離 UX 修正版:
//   - session 自体がなければ新規作成
//   - session 内に既に同 issueId の work があれば **何もしない**（resume）
//   - 同 session 内の別 issueId はそのまま保持（conflict にしない）
//
// answers は deepQuestions.length と同じ長さの空文字配列で初期化（I5）。
// summary / rewriteDraft / startedAt は workspace-level の session 値（既存があれば保持）。
//
// 呼び出し側責務:
//   - sourceReviewIndex が有効 index か確認する
//   - issueId / issueText は workspace.reviews[sourceReviewIndex] と整合させる
//   - axis / deepQuestions は lib/essay/deepDiveQuestions.ts から取り出す
//   - templateVersion は DEEP_DIVE_TEMPLATE_VERSION を渡す
export function startImprovementWork(
  workspace: EssayWorkspace,
  params: {
    issueId: string;
    sourceReviewIndex: number;
    issueText: string;
    axis: BreakdownAxis;
    deepQuestions: string[];
    templateVersion: number;
  },
): EssayWorkspace {
  const now = new Date().toISOString();
  const existing = workspace.improvementInProgress;

  // 同 issueId の work が既にあれば触らない（resume）。
  if (existing?.works[params.issueId]) return workspace;

  const newWork: ImprovementWork = {
    issueId: params.issueId,
    sourceReviewIndex: params.sourceReviewIndex,
    issueText: params.issueText,
    axis: params.axis,
    deepQuestions: params.deepQuestions,
    templateVersion: params.templateVersion,
    // I5: answers length === deepQuestions length。空文字で初期化。
    answers: new Array(params.deepQuestions.length).fill(''),
    startedAt: now,
  };

  const next: ImprovementInProgress = existing
    ? {
        ...existing,
        works: { ...existing.works, [params.issueId]: newWork },
      }
    : {
        works: { [params.issueId]: newWork },
        summary: null,
        rewriteDraft: null,
        startedAt: now,
      };

  return {
    ...workspace,
    improvementInProgress: next,
    updatedAt: now,
  };
}

// 改善 session を破棄する（in-progress を null に戻す）。
// すでに null なら no-op（updatedAt も触らない）で workspace そのまま返す。
// 個別 issue work の削除は提供しない（必要なら abandonImprovement で session ごと捨てる）。
export function abandonImprovement(workspace: EssayWorkspace): EssayWorkspace {
  if (workspace.improvementInProgress === null) return workspace;
  return {
    ...workspace,
    improvementInProgress: null,
    updatedAt: new Date().toISOString(),
  };
}

// 指定 issue の深掘り回答 (answers) のみを更新する。
//
// I5 保証: answers.length は当該 work の deepQuestions.length と一致させる。
//   - 長すぎる入力 → deepQuestions.length まで切る
//   - 短すぎる入力 → 空文字で右パディング
//
// session または該当 work が無い場合は no-op。
// （呼び出し側で「先に startImprovementWork を通す」責任がある）
export function updateImprovementAnswers(
  workspace: EssayWorkspace,
  issueId: string,
  answers: string[],
): EssayWorkspace {
  const inProgress = workspace.improvementInProgress;
  if (!inProgress) return workspace;
  const work = inProgress.works[issueId];
  if (!work) return workspace;

  const expected = work.deepQuestions.length;
  const safe: string[] =
    answers.length === expected
      ? answers
      : work.deepQuestions.map((_q, i) => answers[i] ?? '');

  return {
    ...workspace,
    improvementInProgress: {
      ...inProgress,
      works: { ...inProgress.works, [issueId]: { ...work, answers: safe } },
    },
    updatedAt: new Date().toISOString(),
  };
}

// AI が生成した改善方針 (ImprovementSummary) を improvementInProgress.summary に保存する。
// 既存値があれば上書きする（再生成想定）。
// improvementInProgress が null の場合は no-op（呼び出し側で start を先に通す責任）。
export function attachImprovementSummary(
  workspace: EssayWorkspace,
  summary: ImprovementSummary,
): EssayWorkspace {
  const inProgress = workspace.improvementInProgress;
  if (!inProgress) return workspace;
  return {
    ...workspace,
    improvementInProgress: { ...inProgress, summary },
    updatedAt: new Date().toISOString(),
  };
}

// rewriteDraft（書き直し中の本文）を更新する autosave 用関数。
// improvementInProgress が null の場合は no-op（呼び出し側で start を先に通す責任）。
// workspace.body は触らない（書き直しはまだ「ドラフト」段階、確定は submitRewriteReview）。
export function updateRewriteDraft(
  workspace: EssayWorkspace,
  draft: string,
): EssayWorkspace {
  const inProgress = workspace.improvementInProgress;
  if (!inProgress) return workspace;
  return {
    ...workspace,
    improvementInProgress: { ...inProgress, rewriteDraft: draft },
    updatedAt: new Date().toISOString(),
  };
}

// **最大危険点**: 再添削成功時の集中 transaction（STEP G）。
//
// 不変条件の同時保証:
//   I1: reviews は append のみ
//   I2: 新 ReviewEntry.essayBodySnapshot は rewriteDraft と完全一致
//   I3: workspace.body も同じ rewriteDraft に更新（latest snapshot との一致）
//   I6: improvementInProgress = null（改善ワーク完了）
//   I7: reviews.length が MAX_REVIEWS_PER_WORKSPACE を超えたら先頭 drop
//
// guard（throw する）:
//   - improvementInProgress === null  → 呼び出し側の論理エラー
//   - rewriteDraft === null           → 書き直しドラフトなしでの再添削は禁止
//   両者とも UI 側で防げる経路なので、防御的フォールバックではなく throw で
//   呼び出し側のバグを露呈させる（既存設計レビューで決定）。
//
// 注意:
//   - API 成功後に**だけ**呼ぶこと。API 失敗時にはこの関数を呼んではいけない。
//   - sourceIssueId に session 内 works の issueId を結合して記録（追跡性確保）。
//     責務分離 UX 修正で複数 issue を 1 つの session に集約するため、
//     カンマ区切りで全 issueId を保存する。
export function submitRewriteReview(
  workspace: EssayWorkspace,
  reviewResult: ReviewResult,
): EssayWorkspace {
  const inProgress = workspace.improvementInProgress;
  if (!inProgress) {
    throw new Error(
      'submitRewriteReview: improvementInProgress is null. Call startImprovementWork first.',
    );
  }
  if (inProgress.rewriteDraft === null) {
    throw new Error(
      'submitRewriteReview: rewriteDraft is null. Update rewriteDraft before submitting.',
    );
  }

  // 追跡性: 全 work の issueId をカンマ区切り。複数 issue 統合 session の場合に有用。
  // 単一 issue でも同形式（"r0-improvement"）で保存。
  const issueIds = Object.keys(inProgress.works);
  const sourceIssueId = issueIds.length > 0 ? issueIds.join(',') : undefined;

  const now = new Date().toISOString();
  const newEntry: ReviewEntry = {
    totalScore: reviewResult.totalScore,
    verdict: reviewResult.verdict,
    breakdown: reviewResult.breakdown,
    improvement: reviewResult.improvement,
    goodPoints: reviewResult.goodPoints,
    weakPoints: reviewResult.weakPoints,
    createdAt: now,
    essayBodySnapshot: inProgress.rewriteDraft, // I2
    ...(sourceIssueId !== undefined ? { sourceIssueId } : {}),
  };

  const appended = [...workspace.reviews, newEntry]; // I1: push のみ
  const reviews =
    appended.length > MAX_REVIEWS_PER_WORKSPACE
      ? appended.slice(-MAX_REVIEWS_PER_WORKSPACE) // I7
      : appended;

  return {
    ...workspace,
    reviews,
    body: inProgress.rewriteDraft, // I3: latest snapshot と一致
    improvementInProgress: null, // I6: 改善ワーク完了
    updatedAt: now,
  };
}

// ─── Phase 2 STEP J: 単体フィールド autosave ────────────────────────────────
//
// 各 step page (target / theme / mini / body) で入力ごとに呼ばれる autosave 関数群。
// すべて純関数。localStorage は触らない（呼び出し側で upsertEssayWorkspace を通す）。
// updatedAt のみ更新する。reviews / improvementInProgress / sparring は触らない。

export function updateTarget(
  workspace: EssayWorkspace,
  target: EssayWorkspace['target'],
): EssayWorkspace {
  return {
    ...workspace,
    target,
    updatedAt: new Date().toISOString(),
  };
}

export function updateTheme(
  workspace: EssayWorkspace,
  theme: EssayWorkspace['theme'],
): EssayWorkspace {
  return {
    ...workspace,
    theme,
    updatedAt: new Date().toISOString(),
  };
}

export function updateMini(
  workspace: EssayWorkspace,
  mini: EssayWorkspace['mini'],
): EssayWorkspace {
  return {
    ...workspace,
    mini,
    updatedAt: new Date().toISOString(),
  };
}

// body の事前 autosave（添削前）。
// 注意: 添削成功時の body 確定は appendInitialReview / submitRewriteReview の責務で、
// それらが reviews 末尾の essayBodySnapshot と整合させて body を更新する。
// updateBody は単純な「textarea autosave」用途のみ。
//
// I3 (body と最新 review.essayBodySnapshot の一致) との関係:
//   - reviews 0 件のとき: I3 は不適用、自由に更新可能
//   - reviews ≥ 1 件のとき: updateBody で更新すると一時的に I3 が成立しなくなる
//     ただし添削 submit 時に appendInitialReview / submitRewriteReview を通すことで
//     I3 を再回復する設計。Phase 2 body page は採点を必ず通す前提
export function updateBody(
  workspace: EssayWorkspace,
  body: string,
): EssayWorkspace {
  return {
    ...workspace,
    body,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Phase 2 STEP J: 壁打ちセッション ──────────────────────────────────────

// 壁打ちを開始する。既存セッションがあれば上書き（破棄）する。
//
// 引数 questions は呼び出し側が buildSparringQuestions(ctx) で
// placeholder 置換済みの snapshot を作って渡す前提。
// answers は new Array(questions.length).fill('') で初期化（I10 保証）。
//
// 並行不可: 1 workspace あたり sparring は単数。
export function startSparring(
  workspace: EssayWorkspace,
  params: {
    questions: string[];
    templateVersion: number;
  },
): EssayWorkspace {
  const now = new Date().toISOString();
  const session: SparringSession = {
    questions: params.questions,
    answers: new Array(params.questions.length).fill(''), // I10
    templateVersion: params.templateVersion,
    startedAt: now,
  };
  return {
    ...workspace,
    sparring: session,
    updatedAt: now,
  };
}

// 壁打ち回答の autosave。
//
// I10 保証: answers.length === questions.length に揃える。
//   - 長すぎ: truncate
//   - 短すぎ: 空文字で右パディング
//
// sparring が null の場合は no-op（呼び出し側で startSparring を先に通す責任）。
export function updateSparringAnswers(
  workspace: EssayWorkspace,
  answers: string[],
): EssayWorkspace {
  const sparring = workspace.sparring;
  if (!sparring) return workspace;
  const expected = sparring.questions.length;
  const safe: string[] =
    answers.length === expected
      ? answers
      : sparring.questions.map((_q, i) => answers[i] ?? '');
  return {
    ...workspace,
    sparring: { ...sparring, answers: safe },
    updatedAt: new Date().toISOString(),
  };
}

// 壁打ちセッションを破棄する。
// すでに null なら no-op（updatedAt 不変）。
export function abandonSparring(workspace: EssayWorkspace): EssayWorkspace {
  if (workspace.sparring === null) return workspace;
  return {
    ...workspace,
    sparring: null,
    updatedAt: new Date().toISOString(),
  };
}
