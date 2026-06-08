'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/app/components/Logo';

// ── Header ────────────────────────────────────────────────────────
// 上部ナビは「Home」と「基本情報」だけに限定する。
// 各機能（活動整理 / 自己分析 / 添削 / マッチング / 面接練習 など）への遷移は
// Home 画面内のカードから行う設計（「次にやるべきこと」をガイドする UX）。
// 機能を増やしてもここは増やさない前提のため、配列＋map ではなく直書きにする。
//
// LP（pathname === '/'）だけは別仕様：
//   - PC：Logo（左）/ アンカーナビ 5 本（中央）/「有料サイトへ」ボタン（右）
//   - スマホ：アンカーナビは隠して、Logo +「有料サイトへ」だけ表示（圧迫回避）
// アンカーリンクは <a href="#..."> でページ内移動。スムーズスクロールと
// 固定ヘッダ分のオフセットは layout.tsx の <html> に
// `scroll-smooth scroll-pt-14` を付けて実現している。

const LP_NAV_LINKS = [
  { href: '#recommend', label: 'おすすめ' },
  { href: '#features', label: '機能' },
  { href: '#pricing', label: '料金' },
  { href: '#compare', label: '比較' },
  { href: '#faq', label: 'FAQ' },
] as const;

export function Header() {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  // 認証ページ（/login）では Home / 基本情報 のナビを出さず、ロゴのみ表示する。
  // ログイン完了までユーザーを導くのが目的で、他ページへの導線は不要なため。
  const isAuthPage = pathname === '/login';

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="px-4 h-14 flex items-center gap-2 sm:gap-6">
        <Logo />

        {isLanding ? (
          <>
            {/* LP 内アンカーナビ：PC のみ表示 */}
            <nav className="hidden sm:flex flex-1 justify-center items-center gap-4 lg:gap-6 text-sm">
              {LP_NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="font-medium text-slate-600 hover:text-brand-600 transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </nav>

            {/* 「有料サイトへ」：スマホでは ml-auto で右端、PC は nav の flex-1 が押し出す */}
            <Link
              href="/home"
              className="ml-auto sm:ml-0 px-3 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors whitespace-nowrap"
            >
              有料サイトへ
            </Link>
          </>
        ) : isAuthPage ? null : (
          <nav className="flex items-center gap-1">
            <NavLink href="/home" pathname={pathname}>Home</NavLink>
            <NavLink href="/input/basic" pathname={pathname}>基本情報</NavLink>
          </nav>
        )}
      </div>
    </header>
  );
}

function NavLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string;
  children: ReactNode;
}) {
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
        active ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </Link>
  );
}
