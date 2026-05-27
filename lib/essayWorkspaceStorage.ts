// 小論文 EssayWorkspace の localStorage 正本（STEP A 新規）。
//
// 役割:
//   essayWorkspaces キーへの I/O / normalize / legacy migration / LRU cap。
//   mutation logic は持たず、reviews.push 等の workspace 更新は
//   lib/essay/workspaceOps.ts の純関数群に分離する。
//
// STEP A 範囲:
//   - 公開 API: loadEssayWorkspaces / loadEssayWorkspace / upsertEssayWorkspace
//   - migration: essayPracticeReview から 1 件移行（key 不在時のみ、idempotent）
//   - normalize: 壊れたデータを throw せず安全に落とす（null 返却または除外）
//
// STEP A で意図的にやらないこと:
//   - dual-write（STEP B 着手時に追加）
//   - schemaVersion 管理（defensive parse で代用）
//   - workspaceOps からの mutation 関数の埋め込み
//   - React hook 化
//   - Supabase mirror 連携
//
// 関連:
//   - 型: types/essay.ts
//   - invariant: docs/essay/essay_workspace_invariants.md
//   - legacy: lib/essayPracticeStorage.ts（読み込みのみ参照）

import { safeSetStorage } from '@/lib/storage/safeStorage';
import { loadReviewResult } from '@/lib/essayPracticeStorage';
import type {
  BreakdownAxis,
  BreakdownItem,
  EssayWorkspace,
  ImprovementInProgress,
  ImprovementSummary,
  ImprovementWork,
  ReviewEntry,
  SparringSession,
} from '@/types/essay';

export const ESSAY_WORKSPACES_KEY = 'essayWorkspaces';
export const MAX_ESSAY_WORKSPACES = 10;
export const MAX_REVIEWS_PER_WORKSPACE = 20;

// 並行不可・5 軸 + improvement。types/essay.ts の BreakdownAxis と同集合。
const VALID_AXES: readonly BreakdownAxis[] = [
  '論理構造',
  '具体性',
  '説得力',
  'テーマ理解',
  '独自性',
  'improvement',
];

// ─── 公開 API ──────────────────────────────────────────────────────────────

// 読み込み:
//   1. localStorage の essayWorkspaces キーを直接 raw 読み込み
//      - safeGetStorage を使わない理由: 「キー不在 (null)」と「空配列 ([])」を
//        区別する必要があるため（migration idempotency I9）
//   2. raw === null（キー不在）→ migration を試みる
//   3. raw あり → JSON.parse → normalize → applyLruCap
//
// crash しない: パース失敗・型不一致は空配列を返す。
export function loadEssayWorkspaces(): EssayWorkspace[] {
  if (typeof window === 'undefined') return [];

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ESSAY_WORKSPACES_KEY);
  } catch {
    return [];
  }

  if (raw === null) {
    // キー不在 → migration 経路。
    // 失敗時 (null) は何も保存しない（クリーンユーザーの localStorage を膨らませない）。
    const migrated = migrateFromLegacy();
    if (migrated) {
      const list = applyLruCap([migrated]);
      safeSetStorage(ESSAY_WORKSPACES_KEY, list);
      return list;
    }
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const normalized = parsed
    .map(normalizeEssayWorkspace)
    .filter((w): w is EssayWorkspace => w !== null);
  return applyLruCap(normalized);
}

export function loadEssayWorkspace(id: string): EssayWorkspace | null {
  return loadEssayWorkspaces().find((w) => w.id === id) ?? null;
}

// 同 id の既存 entry は置き換え、無ければ追加。LRU cap 適用後に保存。
// updatedAt は呼び出し側（workspaceOps 等）が更新する責務。本関数では触らない。
export function upsertEssayWorkspace(workspace: EssayWorkspace): void {
  if (typeof window === 'undefined') return;
  const list = loadEssayWorkspaces();
  const filtered = list.filter((w) => w.id !== workspace.id);
  const next = applyLruCap([workspace, ...filtered]);
  safeSetStorage(ESSAY_WORKSPACES_KEY, next);
}

// ─── 公開: id 生成 ────────────────────────────────────────────────────────

// 'ws-{timestamp}-{random4hex}'。ULID 等の依存を避けて crypto-free に作る。
// 衝突確率は同 ms 内 1/65536 で十分低い。upsert 側で id 衝突は merge 扱いになる。
// STEP B で workspaceOps.createInitialWorkspace から使うため export 化。
export function generateWorkspaceId(): string {
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `ws-${Date.now()}-${rand}`;
}

// ─── 内部: LRU cap ────────────────────────────────────────────────────────

// updatedAt 降順で並べて先頭 MAX_ESSAY_WORKSPACES 件を残す。
// ISO 文字列は辞書順 = 時系列順なので localeCompare で十分。
function applyLruCap(list: EssayWorkspace[]): EssayWorkspace[] {
  const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sorted.slice(0, MAX_ESSAY_WORKSPACES);
}

// ─── 内部: legacy migration ──────────────────────────────────────────────

// essayPracticeReview から 1 件の EssayWorkspace を構築する。
// 呼び出し条件は呼び出し側で制御（loadEssayWorkspaces 内で raw === null 時のみ）。
// target / theme / mini は legacy データに含まれないので空欄で埋める。
function migrateFromLegacy(): EssayWorkspace | null {
  let legacy: ReturnType<typeof loadReviewResult>;
  try {
    legacy = loadReviewResult();
  } catch {
    return null;
  }
  if (!legacy) return null;

  const now = legacy.updatedAt || new Date().toISOString();
  const body = legacy.essayBodySnapshot ?? '';

  const entry: ReviewEntry = {
    totalScore: legacy.totalScore,
    verdict: legacy.verdict,
    breakdown: legacy.breakdown,
    improvement: legacy.improvement,
    goodPoints: legacy.goodPoints,
    weakPoints: legacy.weakPoints,
    createdAt: now,
    essayBodySnapshot: body,
  };

  const candidate: EssayWorkspace = {
    id: generateWorkspaceId(),
    createdAt: now,
    updatedAt: now,
    target: { university: '', faculty: '', department: '', examType: '' },
    theme: { text: '', type: '', source: '', reason: '' },
    mini: { conclusion: '', reasonOne: '', reasonTwo: '' },
    body,
    reviews: [entry],
    improvementInProgress: null,
    sparring: null, // Phase 2 で追加された field。legacy にデータ無いため常に null
  };

  // legacy が壊れていた場合の防御として normalize を通す。
  return normalizeEssayWorkspace(candidate);
}

// ─── 内部: defensive normalize ───────────────────────────────────────────

// 任意の raw 値を受けて、復元可能なら EssayWorkspace を返す。
// 復元不可能（id 不在等）は null を返し、呼び出し側で除外する。
// throw しない / crash しない。
function normalizeEssayWorkspace(raw: unknown): EssayWorkspace | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  // id は必須。これだけは補完できない。
  if (typeof r.id !== 'string' || r.id.trim() === '') return null;

  const createdAt =
    typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString();
  const updatedAt = typeof r.updatedAt === 'string' ? r.updatedAt : createdAt;

  const rawReviews = Array.isArray(r.reviews) ? r.reviews : [];
  const normalizedReviews = rawReviews
    .map(normalizeReviewEntry)
    .filter((e): e is ReviewEntry => e !== null);
  // I7: reviews <= 20。古い方から drop。
  const reviews =
    normalizedReviews.length > MAX_REVIEWS_PER_WORKSPACE
      ? normalizedReviews.slice(-MAX_REVIEWS_PER_WORKSPACE)
      : normalizedReviews;

  return {
    id: r.id,
    createdAt,
    updatedAt,
    target: normalizeTarget(r.target),
    theme: normalizeTheme(r.theme),
    mini: normalizeMini(r.mini),
    body: typeof r.body === 'string' ? r.body : '',
    reviews,
    improvementInProgress: normalizeImprovementInProgress(
      r.improvementInProgress,
      reviews.length,
    ),
    sparring: normalizeSparring(r.sparring),
  };
}

function normalizeTarget(raw: unknown): EssayWorkspace['target'] {
  if (typeof raw !== 'object' || raw === null) {
    return { university: '', faculty: '', department: '', examType: '' };
  }
  const r = raw as Record<string, unknown>;
  return {
    university: typeof r.university === 'string' ? r.university : '',
    faculty: typeof r.faculty === 'string' ? r.faculty : '',
    department: typeof r.department === 'string' ? r.department : '',
    examType: typeof r.examType === 'string' ? r.examType : '',
  };
}

function normalizeTheme(raw: unknown): EssayWorkspace['theme'] {
  if (typeof raw !== 'object' || raw === null) {
    return { text: '', type: '', source: '', reason: '' };
  }
  const r = raw as Record<string, unknown>;
  return {
    text: typeof r.text === 'string' ? r.text : '',
    type: typeof r.type === 'string' ? r.type : '',
    source: typeof r.source === 'string' ? r.source : '',
    reason: typeof r.reason === 'string' ? r.reason : '',
  };
}

function normalizeMini(raw: unknown): EssayWorkspace['mini'] {
  if (typeof raw !== 'object' || raw === null) {
    return { conclusion: '', reasonOne: '', reasonTwo: '' };
  }
  const r = raw as Record<string, unknown>;
  return {
    conclusion: typeof r.conclusion === 'string' ? r.conclusion : '',
    reasonOne: typeof r.reasonOne === 'string' ? r.reasonOne : '',
    reasonTwo: typeof r.reasonTwo === 'string' ? r.reasonTwo : '',
  };
}

function normalizeBreakdownItem(raw: unknown): BreakdownItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== 'string') return null;
  if (typeof r.score !== 'number' || !Number.isFinite(r.score)) return null;
  return { label: r.label, score: r.score };
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

function clampScore0to100(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeReviewEntry(raw: unknown): ReviewEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const rawBreakdown = Array.isArray(r.breakdown) ? r.breakdown : [];
  const breakdown = rawBreakdown
    .map(normalizeBreakdownItem)
    .filter((b): b is BreakdownItem => b !== null);

  const entry: ReviewEntry = {
    totalScore: clampScore0to100(r.totalScore),
    verdict: typeof r.verdict === 'string' ? r.verdict : '',
    breakdown,
    improvement: typeof r.improvement === 'string' ? r.improvement : '',
    goodPoints: normalizeStringArray(r.goodPoints),
    weakPoints: normalizeStringArray(r.weakPoints),
    createdAt:
      typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    essayBodySnapshot:
      typeof r.essayBodySnapshot === 'string' ? r.essayBodySnapshot : '',
  };

  if (typeof r.sourceIssueId === 'string') {
    entry.sourceIssueId = r.sourceIssueId;
  }

  return entry;
}

function normalizeImprovementInProgress(
  raw: unknown,
  reviewsLength: number,
): ImprovementInProgress | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const startedAt =
    typeof r.startedAt === 'string' ? r.startedAt : new Date(0).toISOString();
  const summary = normalizeImprovementSummary(r.summary);
  const rewriteDraft =
    typeof r.rewriteDraft === 'string' ? r.rewriteDraft : null;

  // ── 新形式 (works map あり) ──
  if (r.works && typeof r.works === 'object' && !Array.isArray(r.works)) {
    const rawWorks = r.works as Record<string, unknown>;
    const works: Record<string, ImprovementWork> = {};
    for (const [key, rawWork] of Object.entries(rawWorks)) {
      const work = normalizeImprovementWork(rawWork, reviewsLength);
      // I11: works key === work.issueId（一致しないものは捨てる）
      if (work && work.issueId === key) works[key] = work;
    }
    if (Object.keys(works).length === 0) return null;
    return { works, summary, rewriteDraft, startedAt };
  }

  // ── 旧形式（flat fields, Phase 1 / 旧 STEP）からの migration ──
  // top-level に issueId / answers 等がある場合は 1 件の work として wrap する。
  if (typeof r.issueId === 'string' && r.issueId.trim() !== '') {
    const work = normalizeImprovementWork(r, reviewsLength);
    if (!work) return null;
    return {
      works: { [work.issueId]: work },
      summary,
      rewriteDraft,
      startedAt,
    };
  }

  return null;
}

// 1 個の ImprovementWork を normalize する。
// flat 旧形式 / 新形式（works 内）どちらの raw でも受け取れる shape。
function normalizeImprovementWork(
  raw: unknown,
  reviewsLength: number,
): ImprovementWork | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.issueId !== 'string' || r.issueId.trim() === '') return null;
  if (typeof r.issueText !== 'string') return null;
  if (typeof r.sourceReviewIndex !== 'number') return null;

  // I4: sourceReviewIndex は有効な reviews index でなければ work 自体を捨てる。
  if (
    !Number.isInteger(r.sourceReviewIndex) ||
    r.sourceReviewIndex < 0 ||
    r.sourceReviewIndex >= reviewsLength
  ) {
    return null;
  }

  const axis = VALID_AXES.includes(r.axis as BreakdownAxis)
    ? (r.axis as BreakdownAxis)
    : '具体性';

  const deepQuestions = normalizeStringArray(r.deepQuestions);
  const rawAnswers = normalizeStringArray(r.answers);
  // I5: answers と deepQuestions は length 一致。短い側に揃える。
  const answers =
    rawAnswers.length === deepQuestions.length
      ? rawAnswers
      : deepQuestions.map((_q, i) => rawAnswers[i] ?? '');

  const templateVersion =
    typeof r.templateVersion === 'number' && Number.isInteger(r.templateVersion)
      ? r.templateVersion
      : 1;

  const startedAt =
    typeof r.startedAt === 'string' ? r.startedAt : new Date(0).toISOString();

  return {
    issueId: r.issueId,
    sourceReviewIndex: r.sourceReviewIndex,
    issueText: r.issueText,
    axis,
    deepQuestions,
    templateVersion,
    answers,
    startedAt,
  };
}

// 壁打ち（思考整理）セッション。Phase 2 で /essay/structure/[wid]/sparring が使う。
// null は「未開始 or 破棄済み」を意味する。
//
// I10 (sparring の length pair): answers.length === questions.length を保つ。
// 壊れた raw は null に倒す（呼び出し側を破壊しない）。
function normalizeSparring(raw: unknown): SparringSession | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const questions = normalizeStringArray(r.questions);
  // questions 空はセッション復元不能と見なし null。
  if (questions.length === 0) return null;

  const rawAnswers = normalizeStringArray(r.answers);
  // I10: answers length === questions length。短い側に揃える。
  const answers =
    rawAnswers.length === questions.length
      ? rawAnswers
      : questions.map((_q, i) => rawAnswers[i] ?? '');

  const templateVersion =
    typeof r.templateVersion === 'number' && Number.isInteger(r.templateVersion)
      ? r.templateVersion
      : 1;

  const startedAt =
    typeof r.startedAt === 'string' ? r.startedAt : new Date(0).toISOString();

  return { questions, answers, templateVersion, startedAt };
}

// improvement の AI まとめ（summary / focusPoints / suggestedDirections）。
// null は「未生成」を意味する。形式不正は null に倒す（読み出し側を破壊しない）。
function normalizeImprovementSummary(raw: unknown): ImprovementSummary | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.summary !== 'string') return null;
  return {
    summary: r.summary,
    focusPoints: normalizeStringArray(r.focusPoints),
    suggestedDirections: normalizeStringArray(r.suggestedDirections),
  };
}
