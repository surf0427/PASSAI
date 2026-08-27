// 受験チューターAI「直近のプレゼン練習の結果」section の **純関数** 正本（Stage 5.9）。
//
// ★ なぜ独立 module なのか ★
//   この正規化規則は元々 `lib/contextBuilders/tutorContext.ts` の
//   `loadPresentationContext` と `buildTutorSupabaseContextSection` に
//   埋め込まれていた。しかし `tutorContext.ts` は `server-only` を transitively
//   import するため、
//     - canonical 側の Spine projection から使えない
//     - QA から import できない（characterization が対象外にしている理由でもある）
//   という制約がある。規則を canonical 側へ書き写すと legacy と静かにずれ、
//   shadow comparison そのものが意味を失う（E-P6 / Stage 5.7 interview_record と同じ判断）。
//   そこで **I/O を持たない部分だけ**をこの module へ出し、legacy と canonical の
//   双方がここを唯一の正本として import する。
//
// ★ 責務は 2 つだけ ★
//   projectTutorPresentationContext … 保存済み評価 → prompt に出す値（選択 / 整形 / 件数 / ラベル）
//   renderTutorPresentationLines    … その値 → prompt の行
//   read（Supabase / 順序 / limit）は呼び出し側が持つ。
//
// 純関数。I/O / env / Math.random を持たない。
// `formatPresentationDateJst` は引数の ISO 文字列だけに依存する（現在時刻を読まない）。

// ── presentation 固有の正規化定数（ここが唯一の正本）─────────────────
//
// ⚠️ `itemLength` / `summaryLength` は tutorContext.ts の
//    MAX_ITEM_LENGTH / MAX_SUMMARY_LENGTH と同じ値でなければならない。
//    section 全体の 1200 字上限を前提に決まっている共有語彙のため、
//    ずれを黙って通さないよう QA（stage5_9）が両者の一致を検査する。
export const TUTOR_PRESENTATION_LIMITS = {
  /** 大学名 / 学部名 / 配列 1 要素の最大長 */
  itemLength: 40,
  /** 総合評価 / テーマの最大長 */
  summaryLength: 120,
  good: 3,
  improve: 3,
  next: 2,
} as const;

/** プレゼン評価カテゴリ key → 日本語ラベル（結果画面 CATEGORY_ORDER と一致）。 */
export const PRESENTATION_CATEGORY_LABELS: Record<string, string> = {
  composition: '構成力',
  persuasion: '説得力',
  concreteness: '具体性',
  clarity: 'わかりやすさ',
  timeManagement: '時間配分',
  completeness: '完成度',
  materialConsistency: '資料整合性',
};

/** プレゼン評価カテゴリの順序（資料整合性は存在時のみ末尾に付与）。 */
export const PRESENTATION_CATEGORY_ORDER: readonly string[] = [
  'composition',
  'persuasion',
  'concreteness',
  'clarity',
  'timeManagement',
  'completeness',
  'materialConsistency',
];

/** weak/normal/strong → 日本語ラベル（結果画面 LEVEL_LABEL と一致）。 */
export const PRESENTATION_LEVEL_LABELS: Record<string, string> = {
  weak: '要改善',
  normal: '標準',
  strong: '良い',
};

// ── 型 ───────────────────────────────────────────────────────────

/** prompt に出る presentation の値。空の field は key ごと落とす（legacy と同じ）。 */
export type TutorPresentationContext = {
  date?: string;
  university?: string;
  faculty?: string;
  theme?: string;
  overall?: string;
  goodPoints?: string[];
  improvements?: string[];
  nextPractice?: string[];
  categories?: { label: string; level: string }[];
};

/**
 * projection の入力。
 *
 * ★ `feedback` は `presentation_results.feedback`（jsonb）★
 *   `presentation_results` には別途 `categories` column があるが、それは
 *   書込時に `projectCategories(feedback) = { ...feedback.categories }` で作られる
 *   **派生コピー**であり、`DEFAULT '{}'` を持つ。legacy が読んでいるのは
 *   一貫して `feedback.categories` なので、こちらを authority とする。
 *   column 側を使うと「似た値だが出所が違う」射影になる（Stage 5.8 essay の教訓）。
 *
 * session 由来 3 値は enrichment。取れなければ undefined のままでよい。
 */
export type TutorPresentationSource = {
  feedback: unknown;
  createdAt: unknown;
  universityName?: unknown;
  facultyName?: unknown;
  theme?: unknown;
};

// ── 内部 helper（tutorContext.ts と同一挙動）──────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function toStringArray(value: unknown, max: number): string[] {
  const { itemLength } = TUTOR_PRESENTATION_LIMITS;
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, max)
    .map((s) => (s.length > itemLength ? s.slice(0, itemLength) : s));
}

/**
 * ISO → JST の年月日。引数だけに依存する（現在時刻を読まない）。
 * 解釈できない値は空文字（legacy と同じく行を落とす方向へ倒す）。
 */
export function formatPresentationDateJst(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

// ── projection ───────────────────────────────────────────────────

/**
 * 保存済みのプレゼン評価 1 件 → prompt に出す値。
 *
 * ★ 出せるものが 1 つも無ければ `null` ★
 *   legacy は section 自体を出さない。ここで代替文言を作らない
 *   （missing は missing のまま。false-empty を作らない）。
 *
 * `feedback` が object でない（null / 配列 / 文字列）場合も `null`。
 */
export function projectTutorPresentationContext(
  src: TutorPresentationSource | null | undefined,
): TutorPresentationContext | null {
  if (!src) return null;
  const feedback = asRecord(src.feedback);
  if (!feedback) return null;

  const { itemLength, summaryLength, good, improve, next } = TUTOR_PRESENTATION_LIMITS;

  const overall = truncate(toTrimmedString(feedback.overallComment), summaryLength);
  const goodPoints = toStringArray(feedback.goodPoints, good);
  const improvements = toStringArray(feedback.improvements, improve);
  const nextPractice = toStringArray(feedback.nextPractice, next);

  // カテゴリ評価（存在時のみ）。weak/normal/strong を日本語ラベルへ。
  // 資料整合性は ORDER の末尾にあるため、付いていれば末尾に出る。
  const cats = asRecord(feedback.categories);
  const categories: { label: string; level: string }[] = [];
  if (cats) {
    for (const key of PRESENTATION_CATEGORY_ORDER) {
      const level = PRESENTATION_LEVEL_LABELS[toTrimmedString(cats[key])];
      if (level) {
        categories.push({ label: PRESENTATION_CATEGORY_LABELS[key], level });
      }
    }
  }

  const hasAny =
    overall !== '' ||
    goodPoints.length > 0 ||
    improvements.length > 0 ||
    nextPractice.length > 0 ||
    categories.length > 0;
  if (!hasAny) return null;

  const date = formatPresentationDateJst(toTrimmedString(src.createdAt));

  // enrichment（best-effort）。取れていなければ空文字 → key ごと落ちる。
  const university = truncate(toTrimmedString(src.universityName), itemLength);
  const faculty = truncate(toTrimmedString(src.facultyName), itemLength);
  const theme = truncate(toTrimmedString(src.theme), summaryLength);

  return {
    ...(date !== '' ? { date } : {}),
    ...(university !== '' ? { university } : {}),
    ...(faculty !== '' ? { faculty } : {}),
    ...(theme !== '' ? { theme } : {}),
    ...(overall !== '' ? { overall } : {}),
    ...(goodPoints.length > 0 ? { goodPoints } : {}),
    ...(improvements.length > 0 ? { improvements } : {}),
    ...(nextPractice.length > 0 ? { nextPractice } : {}),
    ...(categories.length > 0 ? { categories } : {}),
  };
}

// ── render ───────────────────────────────────────────────────────

/**
 * presentation の値 → prompt の行。
 * `buildTutorSupabaseContextSection` が push しているのと同じ文字列を返す。
 * 値が無ければ空配列（section に 1 行も出さない）。
 */
export function renderTutorPresentationLines(
  pr: TutorPresentationContext | null | undefined,
): string[] {
  if (!pr) return [];
  const lines: string[] = [];

  const headParts: string[] = [];
  if (pr.date) headParts.push(`${pr.date}実施`);
  if (pr.university) {
    headParts.push(pr.faculty ? `${pr.university} ${pr.faculty}` : pr.university);
  }
  const head = headParts.join('・');
  lines.push(`・直近のプレゼン練習${head ? `（${head}）` : ''}の結果が保存されています。`);

  if (pr.theme) lines.push(`  - 発表テーマ: ${pr.theme}`);
  if (pr.overall) lines.push(`  - 総合評価: ${pr.overall}`);
  if (pr.categories && pr.categories.length > 0) {
    lines.push(
      `  - カテゴリ評価: ${pr.categories.map((c) => `${c.label}=${c.level}`).join(' / ')}`,
    );
  }
  if (pr.goodPoints && pr.goodPoints.length > 0) {
    lines.push(`  - 良かった点: ${pr.goodPoints.map((s) => `「${s}」`).join('')}`);
  }
  if (pr.improvements && pr.improvements.length > 0) {
    lines.push(`  - 改善点: ${pr.improvements.map((s) => `「${s}」`).join('')}`);
  }
  if (pr.nextPractice && pr.nextPractice.length > 0) {
    lines.push(`  - 次に練習すると良い点: ${pr.nextPractice.map((s) => `「${s}」`).join('')}`);
  }
  return lines;
}
