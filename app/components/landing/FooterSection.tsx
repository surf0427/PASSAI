import Link from 'next/link';
import { Logo } from '@/app/components/Logo';

// 公開ページ共通 footer。グローバル layout には入れず、公開ページ
// （/, /pricing, /login, /terms, /privacy, /legal/commerce, /about, /contact）で
// 個別に描画する。ログイン後の作業画面（/home, 各AI機能ページ等）には出さない。
// スマホ：ブランド → リンク列 → コピーライト の縦並び。
// PC：ブランド（左）／リンク列（右）の左右配置 + 下にコピーライト。

export function FooterSection() {
  return (
    <footer className="bg-slate-50 border-t border-slate-200">
      <div className="mx-auto max-w-5xl px-6 sm:px-8 py-10 sm:py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between sm:gap-12">
          {/* ブランド */}
          <div>
            <Logo />
            <p className="mt-3 text-xs sm:text-sm text-slate-500 leading-relaxed">
              総合型選抜・学校推薦型選抜のためのAI受験サポート
            </p>
          </div>

          {/* リンク列 */}
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link
              href="/about"
              className="text-slate-600 hover:text-slate-900 transition-colors"
            >
              運営者情報
            </Link>
            <Link
              href="/terms"
              className="text-slate-600 hover:text-slate-900 transition-colors"
            >
              利用規約
            </Link>
            <Link
              href="/privacy"
              className="text-slate-600 hover:text-slate-900 transition-colors"
            >
              プライバシーポリシー
            </Link>
            <Link
              href="/legal/commerce"
              className="text-slate-600 hover:text-slate-900 transition-colors"
            >
              特定商取引法に基づく表記
            </Link>
            <Link
              href="/contact"
              className="text-slate-600 hover:text-slate-900 transition-colors"
            >
              お問い合わせ
            </Link>
          </nav>
        </div>

        {/* コピーライト */}
        <p className="mt-8 sm:mt-10 pt-6 border-t border-slate-200 text-xs text-slate-500 text-center sm:text-left">
          © 2026 PASSAI
        </p>
      </div>
    </footer>
  );
}
