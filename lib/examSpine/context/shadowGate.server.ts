// PASSAI 受験版 Exam Spine — Stage 5.0 shadow assembly の activation gate（E-S11）。
//
// ★ default deny ★
//   env 未設定 / 空 / 不正値はすべて「誰にも有効にしない」に倒す。
//   コードに default true や development 自動 ON を入れない。
//
// ★ purpose flag AND user allowlist の連言（E-S11）★
//   purpose を列挙しただけでは誰にも届かない。allowlist を別 env で明示させることで
//   「全開放する意思」を分離し、事故 ON を構造的に防ぐ。
//
// shadow が ON のときにすること / しないこと:
//   する   … canonical context を組み立てる（read + assemble のみ）
//   しない … AI 呼び出し / DB 書き込み / response 変更 / prompt 変更
//
// server-only の env（`NEXT_PUBLIC_` を付けない）。値は毎回読む（cache しない）。
// 再 deploy 無しの切り戻しを妨げないため。

import type { ExamContextPurpose } from '../types';
import { isExamContextPurpose } from '../types';

/** `EXAM_SPINE_SHADOW_PURPOSES` — カンマ区切りの purpose。未設定なら誰にも ON にならない。 */
function enabledPurposes(): ReadonlySet<ExamContextPurpose> {
  const raw = process.env.EXAM_SPINE_SHADOW_PURPOSES;
  if (typeof raw !== 'string') return new Set();
  const out = new Set<ExamContextPurpose>();
  for (const token of raw.split(',')) {
    const value = token.trim();
    if (isExamContextPurpose(value)) out.add(value);
  }
  return out;
}

/** `EXAM_SPINE_SHADOW_USER_IDS` — カンマ区切りの userId。**空なら誰も許可しない**（default deny）。 */
function allowlist(): ReadonlySet<string> {
  const raw = process.env.EXAM_SPINE_SHADOW_USER_IDS;
  if (typeof raw !== 'string') return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * その purpose / user について shadow assembly を実行してよいか。
 *
 * ★ allowlist が空なら常に false ★
 *   L1 の canary（`TUTOR_SPINE_CONTEXT_ENABLED`）は allowlist 未設定を
 *   「制限なし」と解釈していたが、E-S11 は「全開放する意思を別 env で明示させる」
 *   ことを求めている。Stage 5.0 の shadow は本番 DB read を増やすため、
 *   ここでは**明示された userId にしか**適用しない。
 */
export function isExamSpineShadowEnabled(
  purpose: ExamContextPurpose,
  userId: string,
): boolean {
  if (!userId) return false;
  if (!enabledPurposes().has(purpose)) return false;
  return allowlist().has(userId);
}

/** 観測用の mode 名。PII を含まない enum のみ（E-S12 / E-S13）。 */
export type ExamSpineShadowMode = 'off' | 'shadow';

export function examSpineShadowMode(enabled: boolean): ExamSpineShadowMode {
  return enabled ? 'shadow' : 'off';
}
