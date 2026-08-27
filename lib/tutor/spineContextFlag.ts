// 受験チューターAI の「生徒情報 context を Exam Spine 一本に寄せる」canary flag
// （Exam Spine Phase 3 / runtime kill-switch）。
//
// 設計は lib/examDiagnosis/flag.ts / app/api/interview-ai/realtime/token/route.ts と同形。
// 新しい flag framework は作らず、既存 convention（許可値 Set + trim + 小文字化 +
// default deny + 任意 allowlist）をそのまま踏襲する。
//
// Env var:
//   `TUTOR_SPINE_CONTEXT_ENABLED`
//     - "true" / "1" / "yes"（trim + 小文字化で比較）→ ON 候補。
//     - それ以外（未設定 / 空 / 不正値）→ **OFF（= 現行の legacy 合成を維持）**。
//   `TUTOR_SPINE_CONTEXT_USER_IDS`（任意）
//     - 非空なら allowlist として機能し、列挙された userId だけ ON。
//     - 未設定 / 空 → 制限なし（flag が ON なら全ユーザー ON）。
//
// ⚠️ server-only の env（`NEXT_PUBLIC_` を付けない）。client bundle へ出さない。
//    値は毎回読む（cache しない）。realtime の server flag と同じ扱いで、
//    再 deploy 無しの切り戻しを妨げないため。
//
// ON / OFF の意味（app/api/tutor/route.ts が唯一の consumer）:
//   OFF … block1 + block2(body 由来) + block3(Spine 由来) ＋ userPrompt に body 由来の人物情報
//         = Phase 2 終了時点と完全に同一（rollback path）
//   ON  … block1 + block3(Spine 由来) のみ。body 由来の**人物情報**は prompt に載せない
//         （intent 固有の作業材料 — statementDraft / selfPRDraft / 面接記録等 — は
//           Spine に durable source が無いため従来どおり残す）
//
// 関連:
//   app/api/tutor/route.ts
//   lib/contextBuilders/tutorContext.ts（Spine 由来 section）
//   docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md E-S11（rollout は default deny）

const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes']);

function isFlagEnabled(): boolean {
  const raw = process.env.TUTOR_SPINE_CONTEXT_ENABLED;
  return typeof raw === 'string' && ENABLED_VALUES.has(raw.trim().toLowerCase());
}

// 非空のとき allowlist として機能する。未設定 / 空 → 制限なし（null）。
function parseAllowlist(): Set<string> | null {
  const raw = process.env.TUTOR_SPINE_CONTEXT_USER_IDS;
  if (typeof raw !== 'string') return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

/**
 * 当該 userId に対して「Spine 一本化」を有効にするか。
 *
 * default deny: env 未設定 / 空 / 不正値ではすべて false（= legacy 合成）。
 * userId が空文字のときも false に倒す（判定不能を ON にしない）。
 */
export function isTutorSpineContextEnabled(userId: string): boolean {
  if (!isFlagEnabled()) return false;
  if (!userId) return false;
  const allowlist = parseAllowlist();
  if (allowlist && !allowlist.has(userId)) return false;
  return true;
}

/** 観測ログ用の mode 名。PII を含まない enum のみ。 */
export type TutorContextMode = 'legacy' | 'spine_only';

export function tutorContextMode(spineOnly: boolean): TutorContextMode {
  return spineOnly ? 'spine_only' : 'legacy';
}
