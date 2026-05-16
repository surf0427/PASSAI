// /self-pr マウント時の旧 draft 引き継ぎ用 reader。
// かつて /self-analysis から「自己PRのたたき台」を一時受け渡しする用途で書き込んでいたが、
// その writer は撤去済み。残存している既存 localStorage 値を 1 度だけ排出するために
// loadSelfPRDraft / clearSelfPRDraft のみ残している。
// raw string 形式（JSON.stringify しない）は既存データ互換性のため変更しない。

const DRAFT_KEY = 'selfPR_draft';

export function loadSelfPRDraft(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(DRAFT_KEY);
}

export function clearSelfPRDraft(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DRAFT_KEY);
}
