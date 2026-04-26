// 活動まとめページで生成した「自己PRのたたき台」を一時保存するユーティリティ。
// 将来 Supabase に移行する際はこのファイルだけ書き換える。
//
// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】/analyze（活動まとめ）→ /（自己分析添削）へのページ間の一時的な受け渡し
// 　　　　sessionStorage でないのは、ページ遷移後にリロードしても消えないようにするため
// 【ライフサイクル】app/page.tsx の初回マウント時に読み込んで即削除する（二重適用を防ぐ）
const DRAFT_KEY = 'selfPR_draft';

export function saveSelfPRDraft(text: string): void {
  localStorage.setItem(DRAFT_KEY, text);
}

export function loadSelfPRDraft(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(DRAFT_KEY);
}

export function clearSelfPRDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}
