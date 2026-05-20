import { redirect } from 'next/navigation';

// Phase 7-C: /statement/compare は 4-mode Entry UX (Phase 1) と target line 内蔵の
// score VIEW (Phase 1-B) によって役割を /statement/score / /statement/improve に
// 吸収済み。アプリ内導線は Phase 7-B で完全に消滅した（grep 0 件）。
// 旧 URL を壊さないため route 自体は残し、直接アクセス時のみ /statement/score へ
// 一時 redirect する。helper (lib/passLineComparison.ts) と PassLineComparison/
// 配下のコンポーネントは improve 系から間接利用されているため温存。
export default function StatementComparePage() {
  redirect('/statement/score');
}
