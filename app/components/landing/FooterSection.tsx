import Link from 'next/link';
import { Logo } from '@/app/components/Logo';

// LP 内 footer。グローバル layout には入れず、`/` でだけ表示する。
// スマホ：ブランド → リンク列 → コピーライト の縦並び。
// PC：ブランド（左）／リンク列（右）の左右配置 + 下にコピーライト。
// 法的ページのリンク先（/about, /terms, /privacy, /contact）は未作成（仮）。

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
