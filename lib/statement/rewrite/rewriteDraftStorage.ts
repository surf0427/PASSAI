import {
  safeGetStorage,
  safeSetStorage,
  safeRemoveStorage,
} from '@/lib/storage/safeStorage';

// 志望理由書の軸別「書き直し下書き」。canonical な統合下書き (statementDraft) とは独立した
// work-in-progress 領域として保持する。Phase C ではここに溜め込むだけで、本文へのマージは
// 別 phase で実装する。
//
// key: 'statement_rewrite_drafts'  (JSON)
// 形 : Partial<Record<axisId, RewriteDraftRecord>>
//
// axisId は呼び出し側 (RewriteGuide.axisId) が握る string。
// 'logic' / 'specificity' / 'universityFit' / 'futureGoal' / 'originality' 等。

const KEY = 'statement_rewrite_drafts';

export type RewriteDraftRecord = {
  text: string;
  checkedItems: string[]; // チェック済みチェックリスト項目の「文字列そのもの」
  updatedAt: string;      // ISO 8601
};

export type RewriteDraftsByAxis = Partial<Record<string, RewriteDraftRecord>>;

export function loadRewriteDrafts(): RewriteDraftsByAxis {
  const raw = safeGetStorage<unknown>(KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  // 部分破損データを drop して安全側に倒す。throw しない方針。
  const out: RewriteDraftsByAxis = {};
  for (const [axisId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidRecord(value)) out[axisId] = value;
  }
  return out;
}

export function loadRewriteDraft(axisId: string): RewriteDraftRecord | null {
  return loadRewriteDrafts()[axisId] ?? null;
}

export function saveRewriteDraft(
  axisId: string,
  draft: RewriteDraftRecord,
): void {
  const all = loadRewriteDrafts();
  all[axisId] = draft;
  safeSetStorage(KEY, all);
}

export function clearRewriteDraft(axisId: string): void {
  const all = loadRewriteDrafts();
  if (!(axisId in all)) return;
  delete all[axisId];
  // 全消去で空オブジェクトになるケースも、JSON {} として保存しておく
  // （他軸の下書きが存在する場合に key 自体を消すと混乱するため）。
  if (Object.keys(all).length === 0) {
    safeRemoveStorage(KEY);
    return;
  }
  safeSetStorage(KEY, all);
}

function isValidRecord(v: unknown): v is RewriteDraftRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.text === 'string' &&
    Array.isArray(r.checkedItems) &&
    r.checkedItems.every((c) => typeof c === 'string') &&
    typeof r.updatedAt === 'string'
  );
}
