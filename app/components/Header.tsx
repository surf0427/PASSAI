'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// ── ナビゲーション項目の定義 ─────────────────────────────────────
// 順番・ラベル・リンク先をここだけ変えれば全体に反映される

const NAV_ITEMS = [
  { label: '基本情報',         href: '/input/basic' },
  { label: '活動整理',         href: '/input/activity' },
  { label: 'AI壁打ち',         href: '/analyze' },
  { label: '自己PR添削',       href: '/' },
  { label: '志望校マッチング', href: '/matching' },
] as const;

// ── アクティブ判定 ────────────────────────────────────────────────
// href === '/' のときは完全一致にする（'/' はすべてのパスの前方一致になるため）

function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

// ── Header コンポーネント ────────────────────────────────────────

export function Header() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">

        {/* アプリ名 */}
        <span className="text-sm font-bold text-gray-800 shrink-0">
          AO受験サポート
        </span>

        {/* ナビゲーション */}
        {/* overflow-x-auto でスマホ時は横スクロール可能にする */}
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive(href, pathname)
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
