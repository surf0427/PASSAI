import type { Metadata } from 'next';
import Link from 'next/link';

// ── /privacy（プライバシーポリシー・仮ページ） ─────────────────
// 正式リリース前の placeholder。
// 注意文ブロックは terms と同じ callout 形式に統一して、
// 後で内容を差し替えるときに UI を揃えたまま編集できるようにする。

export const metadata: Metadata = {
  title: 'プライバシーポリシー | PASSAI',
};

export default function PrivacyPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors"
        >
          ← トップに戻る
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
          プライバシーポリシー
        </h1>

        <div className="space-y-5 text-slate-700 leading-relaxed">
          <p>
            このページでは、PASSAIにおける個人情報の取り扱いについて掲載予定です。
          </p>
          <p>
            現在、正式リリースに向けてプライバシーポリシーを準備中です。
            <br />
            正式な内容は、サービス公開時に掲載します。
          </p>
        </div>

        {/* 注意文（公開や同意取得の方針を断定しない範囲で記載） */}
        <div className="mt-8 bg-slate-50 border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-2">
          <p className="text-sm text-slate-600 leading-relaxed">
            ユーザーが入力した情報は、サービス改善および受験対策サポートのために利用される場合があります。
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            個人が特定される情報を本人の同意なく公開することはありません。
          </p>
        </div>
      </div>
    </div>
  );
}
