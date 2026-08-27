// PASSAI 受験版 Exam Spine — Stage 5.1 tutor shadow comparison（純関数）。
//
// legacy tutor context（body 由来）と Canonical Exam Context を **意味単位**で比較する。
//
// ★ prompt 文字列を丸ごと比較しない ★
//   legacy の 1 本の string と canonical の block を string 比較すると、
//   「どの source が原因で違うのか」が復元できず migration の判断に使えない。
//   したがって covered 4 kind について field 単位で比較する。
//
// ★ compare engine は observer であって authority ではない ★
//   ここは read も write もしない。渡された 2 つの出力を比較するだけの純関数で、
//   purpose を広げることも source を verified にすることもできない（§34）。
//   **追加 DB query を 1 本も発行しない。**
//
// ★ raw user content を持ち出さない ★
//   比較は「正規化 → fingerprint → 突き合わせ」で行い、entry には hash と長さしか残さない。
//   hash は sync core の `examFingerprint` を再利用する（並行 hash utility を作らない / §14）。

import { examFingerprint } from '../../sync/fingerprint';
import type { ExamFingerprint } from '../../sync/fingerprint';
import type { ExamSourceKind } from '../../sourceData/types';
import type { ExamContextOrigin } from '../../types';
import type { CanonicalExamContext, ExamSourceProvenance } from '../types';
import {
  EXAM_SHADOW_COMPARISON_VERSION,
  type ExamMigrationReadiness,
  type ExamShadowComparison,
  type ExamShadowDiffEntry,
  type ExamShadowDiffKind,
  type ExamShadowOmissionReason,
  type ExamShadowOverall,
  type ExamSourceReadinessEntry,
} from './types';

/**
 * legacy 側から比較のために取り出した値。
 *
 * ★ route が持っている bridge 値そのものを渡す ★
 *   legacy formatter の出力文字列ではなく、**formatter に入る前の値**を比較する。
 *   文字列を比較すると legacy の見出し・区切りといった表現の差が
 *   意味の差に化けてしまう（§12 の normalization 方針）。
 */
export type TutorLegacyInput = {
  readonly basicInfo?: unknown;
  readonly activityData?: unknown;
  /**
   * legacy の Supabase 層が prompt に出しているカテゴリ別件数の 1 行表現。
   * body 由来ではないので、route が `contextResult.context.activity` から整形して渡す。
   */
  readonly activityCategoryCounts?: unknown;
  readonly studentProfile?: unknown;
  /**
   * legacy の Supabase 層が prompt に出している自己分析 projection
   * （`tutorContext.ts` の `context.selfAnalysis`）。body 由来ではない。
   */
  readonly selfAnalysis?: unknown;
  /** legacy tutor が prompt に出している「志望理由書の課題」行の値。 */
  readonly statementWeaknessLine?: unknown;
  readonly statementReviewLatest?: unknown;
  /** 以下は canonical block coverage 外。存在の記録だけ行う。 */
  readonly essayReviewLatest?: unknown;
  /**
   * legacy の Supabase 層（tutorContext.ts）が prompt へ出している値。
   * body 由来ではないので、route が `contextResult.context` から渡す。
   */
  readonly diagnosisTypeHint?: unknown;
  readonly presentationLatest?: unknown;
  /**
   * ★ この 2 つは同じ 1 レコード由来である（E-S46）★
   *   `app/tutor/page.tsx:423` の `getInterviewRecords()[0]` から両方が作られる。
   *   `interviewFeedbackLatest` は `interview_ai` ではなく、その record の
   *   `feedbackJson` を parse したものである。
   */
  readonly interviewRecordLatest?: unknown;
  readonly interviewFeedbackLatest?: unknown;
  /** legacy tutor が prompt に出している「面接練習の課題」行の値。 */
  readonly interviewIssueLine?: unknown;
  readonly mypageSummary?: unknown;
  readonly statementDraft?: unknown;
};

// ── 正規化（semantic normalization / §12）────────────────────────────
//
// ★ 差分を隠しすぎない ★
//   全 whitespace 削除・全文 lowercase・雑な JSON.stringify 比較はしない。
//   null と '' の同一視、配列順の扱いなど **field ごとに意味で決める**。

/** null / undefined / '' を「値なし」に揃える。0 や false は値として残す。 */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** string[] を正規化（trim / 空除去）。**順序は保つ**（順序が意味を持つ場合があるため）。 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v !== '');
}

/** 志望校の正規化。faculty/department の null と '' を同一視する。 */
function preferences(value: unknown): Array<{ u: string; f: string; d: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ u: string; f: string; d: string }> = [];
  for (const item of value) {
    const rec = record(item);
    if (!rec) continue;
    const u = text(rec.university);
    if (u === '') continue;
    out.push({ u, f: text(rec.faculty), d: text(rec.department) });
  }
  return out;
}


/**
 * canonical 側の値は **block content** から取る。
 * ★ 比較器は source logic を再実装しない ★
 *   diagnosis の言い換えは assembler / block builder が済ませており、
 *   ここでやり直すと 3 つ目の実装になる（E-S35 と同じ失敗）。
 */
function blockContent(context: CanonicalExamContext, id: string): string {
  const block = context.blocks.find((b) => b.id === id);
  return block && block.presence === 'present' ? block.content : '';
}

function fingerprintOf(value: unknown): ExamFingerprint | null {
  return present(value) ? examFingerprint(value) : null;
}

function charsOf(value: unknown): number {
  if (!present(value)) return 0;
  return JSON.stringify(value)?.length ?? 0;
}

// ── entry 構築 ────────────────────────────────────────────────────────

type CompareArgs = {
  readonly field: string;
  readonly kind: ExamSourceKind | null;
  readonly legacy: unknown;
  readonly canonical: unknown;
  readonly provenance: ExamSourceProvenance | null;
  /** 意図的除外なら理由を渡す。渡すとその時点で INTENTIONALLY_OMITTED になる。 */
  readonly omitted?: ExamShadowOmissionReason;
};

function compareField(args: CompareArgs): ExamShadowDiffEntry {
  const base = {
    field: args.field,
    kind: args.kind,
    legacyFingerprint: fingerprintOf(args.legacy),
    canonicalFingerprint: fingerprintOf(args.canonical),
    legacyChars: charsOf(args.legacy),
    canonicalChars: charsOf(args.canonical),
    canonicalState: args.provenance?.state ?? null,
    canonicalOrigin: args.provenance?.origin ?? null,
    syncStatus: args.provenance?.syncStatus ?? null,
  };

  if (args.omitted) {
    return { ...base, diff: 'INTENTIONALLY_OMITTED', reason: args.omitted };
  }

  const hasLegacy = present(args.legacy);
  const hasCanonical = present(args.canonical);

  // canonical source が使える状態でないなら、値の比較は成立しない。
  // 「legacy に値があるのに canonical が unverified」を VALUE_MISMATCH と呼ばない。
  const state = args.provenance?.state ?? null;
  if (state !== null && state !== 'available' && state !== 'empty') {
    return { ...base, diff: 'STATUS_MISMATCH', reason: null };
  }

  if (!hasLegacy && !hasCanonical) {
    // 双方に値が無い。差分ではないので MATCH として数える（空同士の一致）。
    return { ...base, diff: 'MATCH', reason: null };
  }
  if (hasLegacy && !hasCanonical) {
    return { ...base, diff: 'MISSING_CANONICAL', reason: null };
  }
  if (!hasLegacy && hasCanonical) {
    return { ...base, diff: 'EXTRA_CANONICAL', reason: null };
  }

  if (base.legacyFingerprint !== base.canonicalFingerprint) {
    return { ...base, diff: 'VALUE_MISMATCH', reason: null };
  }

  // 値は一致。origin が server でなければ「canonical が bridge を使っただけ」。
  if (args.provenance && args.provenance.origin !== 'server') {
    return { ...base, diff: 'ORIGIN_MISMATCH', reason: null };
  }
  return { ...base, diff: 'MATCH', reason: null };
}

// ── canonical 側の値の取り出し ────────────────────────────────────────
//
// ★ canonical context は sources に生値を持たない（E-S29）★
//   したがって比較用の canonical 値は **assembler へ渡した解決済み入力**から取る。
//   ここでは呼び出し側が渡す `resolvedInput` を使う（route が assembler に渡したものと同一）。

export type TutorCanonicalInput = {
  readonly basicInfo?: unknown;
  readonly activityData?: unknown;
  readonly wallHittingResult?: unknown;
  readonly studentProfile?: unknown;
  readonly previousOutputSummary?: unknown;
  /** canonical rows から作った legacy 相当の行（shadow 専用 / E-S44）。 */
  readonly statementWeaknessLine?: unknown;
};

// ── entry point ───────────────────────────────────────────────────────

export function compareTutorShadow(input: {
  readonly legacy: TutorLegacyInput;
  readonly canonicalInput: TutorCanonicalInput;
  readonly context: CanonicalExamContext;
}): ExamShadowComparison {
  const bySource = new Map<ExamSourceKind, ExamSourceProvenance>();
  for (const s of input.context.sources) bySource.set(s.kind, s);
  const prov = (k: ExamSourceKind): ExamSourceProvenance | null => bySource.get(k) ?? null;

  const legacyBasic = record(input.legacy.basicInfo);
  const canonicalBasic = record(input.canonicalInput.basicInfo);
  const legacySelfAnalysis = record(input.legacy.selfAnalysis);
  const canonicalProfile =
    record(input.canonicalInput.studentProfile) ?? record(input.canonicalInput.wallHittingResult);
  const legacyStatement = record(input.legacy.statementReviewLatest);
  const canonicalStatement = record(input.canonicalInput.previousOutputSummary);

  const entries: ExamShadowDiffEntry[] = [
    // ── basic_info ───────────────────────────────────────────────
    compareField({ field: 'basic_info.grade', kind: 'basic_info',
      legacy: text(legacyBasic?.grade), canonical: text(canonicalBasic?.grade), provenance: prov('basic_info') }),
    compareField({ field: 'basic_info.track', kind: 'basic_info',
      legacy: text(legacyBasic?.track), canonical: text(canonicalBasic?.track), provenance: prov('basic_info') }),
    compareField({ field: 'basic_info.examTypes', kind: 'basic_info',
      legacy: stringList(legacyBasic?.examTypes), canonical: stringList(canonicalBasic?.examTypes), provenance: prov('basic_info') }),
    compareField({ field: 'basic_info.preferences', kind: 'basic_info',
      legacy: preferences(legacyBasic?.preferences), canonical: preferences(canonicalBasic?.preferences), provenance: prov('basic_info') }),
    // 氏名は server payload に存在しない。bridge が保持する契約（E-P8）。
    compareField({ field: 'basic_info.name', kind: 'basic_info',
      legacy: text(legacyBasic?.name), canonical: null, provenance: prov('basic_info'),
      omitted: 'pii_excluded' }),

    // ── activity ─────────────────────────────────────────────────
    //
    // ★ 比較対象は「Tutor が prompt に出している表現」＝カテゴリ別件数 ★
    //   `body.activityData` は client が送る counts 射影であって ActivityData 本体ではない
    //   （app/tutor/page.tsx:392）。一方 legacy の Supabase 層は
    //   `{ totalCount, categoryCounts }` を持ち、そこから 1 行を作っている。
    //   したがって legacy 側は Supabase 層の整形済み件数、canonical 側は
    //   activity_category_counts block の content を突き合わせる。
    //   （Stage 5.1 では body の counts 射影と ActivityData を比べており、
    //     shape が違うため常に空同士になっていた。ここで訂正する。）
    compareField({ field: 'activity.categoryCounts', kind: 'activity',
      legacy: text(input.legacy.activityCategoryCounts),
      canonical: blockContent(input.context, 'activity_category_counts'),
      provenance: prov('activity') }),

    // ── self_analysis ────────────────────────────────────────────
    //
    // ★ legacy 側は Supabase 層の projection を使う ★
    //   Tutor が prompt に出しているのは
    //   `buildTutorSupabaseContextSection` の 4 行（強み / 課題 / 将来の方向性 / 要約）で、
    //   その材料は `tutorContext.ts` の `context.selfAnalysis` である。
    //   body の `studentProfile` は別レイヤー（block2）の材料なので、
    //   そちらと比べると「どの経路の差か」が混ざる（activity で同じ取り違えがあった）。
    compareField({ field: 'self_analysis.summary', kind: 'self_analysis',
      legacy: text(legacySelfAnalysis?.summary), canonical: text(canonicalProfile?.summary), provenance: prov('self_analysis') }),
    compareField({ field: 'self_analysis.strengths', kind: 'self_analysis',
      legacy: stringList(legacySelfAnalysis?.strengths), canonical: stringList(canonicalProfile?.strengths), provenance: prov('self_analysis') }),
    compareField({ field: 'self_analysis.weaknesses', kind: 'self_analysis',
      legacy: stringList(legacySelfAnalysis?.weaknesses), canonical: stringList(canonicalProfile?.weaknesses), provenance: prov('self_analysis') }),
    compareField({ field: 'self_analysis.futureConnections', kind: 'self_analysis',
      legacy: stringList(legacySelfAnalysis?.futureConnections),
      canonical: stringList(canonicalProfile?.futureConnections), provenance: prov('self_analysis') }),

    // ── statement_review ─────────────────────────────────────────
    //   legacy は「直近 1 件の weaknesses」、canonical は履歴からの反復論点要約。
    //   材料が違うので値一致は期待しない。差分として正しく現れることを見る。
    // ★ 比較は「legacy が prompt に出している表現」同士で行う（E-S44）★
    //   canonical の `buildPreviousOutputSummary`（反復論点）は legacy の
    //   「最新 1 件の課題」とは別 projection なので、そのまま突き合わせると
    //   常に VALUE_MISMATCH になり「移行できない」という誤った結論になる。
    //   ここでは canonical rows から legacy 相当の行を作って比べる。
    //   ★ この射影は shadow 専用で prompt へは接続しない。
    compareField({ field: 'statement_review.latestWeaknessLine', kind: 'statement_review',
      legacy: text(input.legacy.statementWeaknessLine),
      canonical: text(input.canonicalInput.statementWeaknessLine),
      provenance: prov('statement_review') }),
    // 反復論点は legacy に対応物が無い（canonical 固有の projection）。
    compareField({ field: 'statement_review.repeatedAdvice', kind: 'statement_review',
      legacy: null, canonical: stringList(canonicalStatement?.repeatedAdvice),
      provenance: prov('statement_review'), omitted: 'legacy_only_metadata' }),
    // 志望理由書の本文は canonical に載せない（E-P5）。
    compareField({ field: 'statement_review.essayBody', kind: 'statement_review',
      legacy: text(legacyStatement?.essay), canonical: null, provenance: prov('statement_review'),
      omitted: 'raw_body_excluded' }),

    // ── legacy の Supabase 層（lib/contextBuilders/tutorContext.ts）由来 ──────
    //   ★ この 3 kind は body ではなく **legacy 側の server read** から prompt に入る ★
    //     buildTutorSupabaseContextSection が diagnosis.typeHint /
    //     interviewAi / presentation を section に出している。
    //     canonical 側には対応する Stage 2 block がまだ無いため、
    //     Tutor を canonical へ移すとこれらが prompt から落ちる。
    //     = consumer migration の実 blocker であることを明示的に記録する。
    // ★ Stage 5.2 で canonical block ができたので実比較へ昇格（G1）★
    //   legacy 側は tutorContext の diagnosis.typeHint、canonical 側は
    //   diagnosis_type_hint block の content。どちらも同じ言い換え表を通るため、
    //   同じ resultType なら文字列まで一致する。
    compareField({ field: 'diagnosis.typeHint', kind: 'diagnosis',
      legacy: text(input.legacy.diagnosisTypeHint),
      canonical: blockContent(input.context, 'diagnosis_type_hint'),
      provenance: prov('diagnosis') }),
    compareField({ field: 'presentation.latest', kind: 'presentation',
      legacy: input.legacy.presentationLatest, canonical: null, provenance: prov('presentation'),
      omitted: 'no_canonical_block' }),

    // ── canonical block coverage 外（Stage 2 未対応 kind）──────────
    compareField({ field: 'essay.reviewLatest', kind: 'essay',
      legacy: input.legacy.essayReviewLatest, canonical: null, provenance: prov('essay'),
      omitted: 'no_canonical_block' }),
    // ── interview_record ─────────────────────────────────────────
    //
    // ★ Stage 5.7 で canonical block ができたので実比較へ昇格（G5 / E-S46）★
    //   ★ 比較対象は「Tutor が prompt に出している表現」＝課題 1 行 ★
    //     legacy の `interviewRecordLatest` は `{ improvementSummary, whatWentWrong }`
    //     という 2 field の record で、canonical 側の block content は整形後の 1 行。
    //     shape が違うものを突き合わせると常に VALUE_MISMATCH になり
    //     「移行できない」という誤った結論になる（statement_review と同じ罠）。
    //     どちらも `buildInterviewLine` を通した値で比べる。
    compareField({ field: 'interview_record.issueLine', kind: 'interview_record',
      legacy: text(input.legacy.interviewIssueLine),
      canonical: blockContent(input.context, 'interview_issue_line'),
      provenance: prov('interview_record') }),
    // 面接本文 / Q&A / betterAnswer / スコアは canonical に載せない（E-P5）。
    // legacy も prompt に出していないが、canonical query が verbatim 列を
    // SELECT していないことを表に残す。
    compareField({ field: 'interview_record.verbatim', kind: 'interview_record',
      legacy: null, canonical: null, provenance: prov('interview_record'),
      omitted: 'raw_body_excluded' }),

    // ── interview_ai ─────────────────────────────────────────────
    //
    // ★ `interviewFeedbackLatest` は interview_ai ではない（E-S46）★
    //   名前に反して、この値は `interview_practice_records.feedback_json` である
    //   （app/tutor/page.tsx:423-436）。したがって interview_ai kind の
    //   legacy 対応物は **存在しない**。ここに legacy 値を置くと
    //   「interview_ai が prompt に出ている」という誤った記録になる。
    //   interview_ai（G3）は依然 canonical block 未実装であり、
    //   legacy tutor prompt にも現れない。
    compareField({ field: 'interview_ai.feedbackLatest', kind: 'interview_ai',
      legacy: null, canonical: null, provenance: prov('interview_ai'),
      omitted: 'no_canonical_block' }),

    // ── legacy 専用（canonical source を持たない）────────────────
    compareField({ field: 'legacy.mypageSummary', kind: null,
      legacy: input.legacy.mypageSummary, canonical: null, provenance: null,
      omitted: 'legacy_only_metadata' }),
    compareField({ field: 'legacy.statementDraft', kind: null,
      legacy: input.legacy.statementDraft, canonical: null, provenance: null,
      omitted: 'not_server_capable' }),
  ];

  return summarize(input.context, entries);
}

// ── 集計 / readiness ──────────────────────────────────────────────────

/**
 * Stage 2 block を持ち、readiness を判定できる kind。
 * ★ block を追加したらここにも足す ★ 足し忘れると「block はあるのに
 *   readiness に現れない」状態になり、migration の可否が表に出ない。
 */
const COVERED_KINDS: readonly ExamSourceKind[] = [
  'basic_info',
  'activity',
  'self_analysis',
  'statement_review',
  // Stage 5.2（G1）で diagnosis_type_hint block を追加した。
  'diagnosis',
  // Stage 5.7（G5）で interview_issue_line block を追加した。
  'interview_record',
];

function summarize(
  context: CanonicalExamContext,
  entries: readonly ExamShadowDiffEntry[],
): ExamShadowComparison {
  const comparable = entries.filter(
    (e) => e.diff !== 'INTENTIONALLY_OMITTED' && e.diff !== 'UNCOMPARABLE',
  );
  const matchCount = comparable.filter((e) => e.diff === 'MATCH').length;
  const mismatchCount = comparable.length - matchCount;
  const intentional = entries.length - comparable.length;

  let overall: ExamShadowOverall;
  if (comparable.length === 0) overall = 'insufficient_evidence';
  else if (mismatchCount === 0) overall = intentional > 0 ? 'compatible_with_omissions' : 'equivalent';
  else overall = 'not_equivalent';

  const bySource = new Map<ExamSourceKind, ExamSourceProvenance>();
  for (const s of context.sources) bySource.set(s.kind, s);

  const readiness: ExamSourceReadinessEntry[] = COVERED_KINDS.map((kind) => {
    const p = bySource.get(kind);
    const kindEntries = comparable.filter((e) => e.kind === kind);
    const blocking = [...new Set(kindEntries.filter((e) => e.diff !== 'MATCH').map((e) => e.diff))];
    // ★ false-empty MATCH を READY にしない ★
    //   双方に値が無い比較は `MATCH` として数えるが、それだけで「移行して大丈夫」とは
    //   言えない。fixture や shape 違いで両側が空になっているだけの可能性があるためで、
    //   実際 activity と self_analysis で「shape 違いにより常に空同士」という
    //   latent bug が起きていた。少なくとも 1 つは **実データのある比較**が
    //   MATCH していることを要求する。
    const meaningful = kindEntries.filter(
      (e) => e.legacyFingerprint !== null || e.canonicalFingerprint !== null,
    );
    return {
      kind,
      readiness: readinessOf(blocking, meaningful.length),
      blockingDiffs: blocking,
      canonicalState: p?.state ?? 'unsupported',
      canonicalOrigin: (p?.origin ?? 'bridge') as ExamContextOrigin,
    };
  });

  return {
    version: EXAM_SHADOW_COMPARISON_VERSION,
    purpose: context.purpose,
    overall,
    comparableCount: comparable.length,
    matchCount,
    mismatchCount,
    intentionalOmissionCount: intentional,
    entries,
    readiness,
    inputBytes: JSON.stringify(entries).length,
  };
}

function readinessOf(
  blocking: readonly ExamShadowDiffKind[],
  meaningfulComparisons: number,
): ExamMigrationReadiness {
  // 実データのある比較が 1 つも無いなら「一致した」とは言えない（§false-empty guard）。
  if (meaningfulComparisons === 0) return 'DEFERRED';
  if (blocking.length === 0) return 'READY';
  // Source-Sync がまだ通電していない / block 未実装は「作業待ち」であって不可ではない。
  if (blocking.every((d) => d === 'STATUS_MISMATCH' || d === 'ORIGIN_MISMATCH')) return 'DEFERRED';
  if (blocking.includes('UNCOMPARABLE')) return 'DEFERRED';
  return 'NOT_READY';
}
