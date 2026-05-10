import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';

// ── /about（運営者情報・仮ページ） ─────────────────────────────
// 正式リリース前の placeholder。詳細は順次差し替える前提で、
// 構造はシンプルに（h1 + 段落 + トップへ戻るリンク）。

export const metadata: Metadata = {
  title: '運営者情報 | PASSAI',
};

export default function AboutPage() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors"
        >
          ← トップに戻る
        </Link>

        <PageHeader title="運営者情報" />

        <div className="space-y-5 text-slate-700 leading-relaxed">
          <p>
            PASSAIは、総合型選抜・学校推薦型選抜を目指す受験生が、活動整理・自己分析・志望理由書・小論文・面接対策を1つの流れで進められるように作られたAI受験サポートサービスです。
          </p>
          <p>
            現在、正式リリースに向けて準備中です。
            <br />
            運営者情報の詳細は、サービス公開時に順次掲載予定です。
          </p>
        </div>
      </div>
    </div>
  );
}
