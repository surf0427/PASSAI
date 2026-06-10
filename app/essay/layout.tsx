// /essay 配下の共有レイアウト。
//
// 唯一の責務: 小論文 Supabase mirror の保存状態バッジ（EssayMirrorStatusBadge）を
// 全 essay ページで 1 度だけマウントすること。children はそのまま通す（既存 UX 不変）。
// バッジは client component で、保存中 / 保存済み / 失敗を画面右下に控えめに表示する。

import type { ReactNode } from 'react';
import { EssayMirrorStatusBadge } from './components/EssayMirrorStatusBadge';

export default function EssayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <EssayMirrorStatusBadge />
    </>
  );
}
