import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalSection } from '@/components/legal/LegalSection';
import { PageHeader } from '@/components/ui/PageHeader';

// STEP-LEGAL-02: PASSAI の正式プライバシーポリシー (初版)。
//
// LEGAL-01 利用規約との整合性:
//   - 「当サービス」呼称統一 / ます調 / 制定日揃え (2026-06-02)
//   - 利用規約 第11条 (知的財産権) の "サービス提供、運用、品質改善、不正利用防止、
//     匿名化された統計分析、研究開発" を利用目的として本ポリシーに具体化
//   - 利用規約 LEGAL-01 残課題だった「未成年者の保護者同意」を本ポリシー第 10 条で補完
//   - 利用規約 第4条 のカード情報非保持を本ポリシー第 2 / 8 条で再明示
//
// 文体: スタートアップ SaaS として自然なます調、平易な日本語、当サービス/ユーザー統一。

export const metadata: Metadata = {
  title: 'プライバシーポリシー | PASSAI',
};

const ENACTED_AT = '2026年6月2日';

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

        <PageHeader title="プライバシーポリシー" />

        <p className="text-sm text-slate-500 mb-8">制定日: {ENACTED_AT}</p>

        <div className="space-y-3 text-slate-700 leading-relaxed mb-10">
          <p className="text-sm">
            PASSAI 運営チーム (以下「当サービス」) は、サービス「PASSAI」
            (以下「本サービス」) を提供するにあたり、ユーザー (以下「ユーザー」)
            から取得する情報の取り扱いについて本プライバシーポリシー (以下「本ポリシー」)
            を定めます。本ポリシーは{' '}
            <Link href="/terms" className="text-brand-700 hover:underline">
              利用規約
            </Link>{' '}
            と一体のものとして適用されます。
          </p>
        </div>

        <div className="space-y-8">
          <LegalSection number={1} title="基本方針">
            <p>
              当サービスは、ユーザーの個人情報を適切に取り扱うことが社会的責務であると
              考え、個人情報の保護に関する法律をはじめとする関連法令を遵守し、本ポリシーに
              基づき個人情報を取り扱います。
            </p>
          </LegalSection>

          <LegalSection number={2} title="取得する情報">
            <p>
              当サービスは、本サービスの提供にあたり以下の情報を取得します。
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>アカウント情報</strong>: 匿名認証ID
                (Supabase Auth が発行する UUID)、登録された場合のメールアドレス
              </li>
              <li>
                <strong>決済関連情報</strong>: Stripe Customer ID、購読プラン
                (Basic / Premium / Free)、購読状態 (active / canceled / past_due 等)、
                次回更新日。
                <br />
                <span className="text-slate-500">
                  ※ カード番号、有効期限、セキュリティコード等の決済情報は Stripe, Inc.
                  が直接取得し、当サービスのサーバには保存されません。
                </span>
              </li>
              <li>
                <strong>利用履歴</strong>: AI 機能の利用回数、利用日時、利用機能の
                識別子、利用モデル、処理結果のステータス (成功 / エラー / 利用上限超過)
              </li>
              <li>
                <strong>ユーザーが入力した内容</strong>:
                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-slate-600">
                  <li>志望理由書原稿、整理メモ</li>
                  <li>小論文原稿、改善方針メモ</li>
                  <li>自己分析の回答、深掘りメモ、自由メモ</li>
                  <li>面接質問、回答、フィードバック対象データ</li>
                  <li>自己PR の本文</li>
                  <li>Tutor の会話履歴</li>
                  <li>基本情報 (学年、志望校・志望学部、受験方式、評定等)</li>
                </ul>
              </li>
              <li>
                <strong>アクセスログ</strong>: IPアドレス、ブラウザ種別、リクエスト日時、
                参照ページ等 (ホスティング基盤および Web アプリケーションのサーバが
                技術的に取得する情報)
              </li>
            </ul>
          </LegalSection>

          <LegalSection number={3} title="利用目的">
            <p>取得した情報は、以下の目的の達成に必要な範囲で利用します。</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>本サービスの提供および機能の継続的な改善</li>
              <li>アカウントの認証および管理</li>
              <li>有料プランの課金処理および購読状態の同期</li>
              <li>AI 機能 (Anthropic Claude) への入力および推論結果の取得</li>
              <li>
                サービス品質の向上、不具合の検出と修正、利用パターンの分析
              </li>
              <li>匿名化されたデータでの統計分析および研究開発</li>
              <li>不正利用、利用規約違反、セキュリティ脅威の検出と防止</li>
              <li>ユーザーからのお問い合わせへの対応</li>
              <li>
                利用規約・本ポリシーの変更、メンテナンス情報、その他の重要なお知らせの送信
              </li>
            </ol>
          </LegalSection>

          <LegalSection number={4} title="第三者提供と業務委託">
            <p>
              当サービスは、法令で認められる場合 (司法手続き、生命・身体・財産の保護等)
              を除き、ユーザーの同意なく個人情報を第三者に提供することはありません。
            </p>
            <p>
              ただし、本サービスの提供にあたり、以下の事業者に処理の一部を委託しており、
              必要な範囲で情報を提供します。各事業者と適切な取扱契約を締結し、安全管理が
              行われるよう努めます。
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Stripe, Inc.</strong> (米国) — 決済処理。取扱情報:
                メールアドレス、Stripe Customer ID、購読情報、決済カード情報
                (ユーザーが Stripe Checkout で直接入力)
              </li>
              <li>
                <strong>Anthropic, PBC</strong> (米国) — AI 推論 (Claude API)。
                取扱情報: ユーザーが AI 機能に入力した文章 (志望理由書、小論文、
                自己分析の回答、面接質問・回答、Tutor への質問等)
              </li>
              <li>
                <strong>Supabase, Inc.</strong> (米国) — データベースおよび認証基盤。
                取扱情報: アカウント情報、メールアドレス、利用履歴、購読状態、
                ユーザー入力内容のうちサーバ側で保存するもの
              </li>
              <li>
                <strong>Vercel, Inc.</strong> (米国) — ホスティング、CDN、エッジ配信。
                取扱情報: アクセスログ、リクエスト・レスポンスのメタデータ
              </li>
            </ul>
            <p className="text-xs text-slate-500">
              各事業者のプライバシーポリシーは、各社の公式サイトをご確認ください。
            </p>
          </LegalSection>

          <LegalSection number={5} title="越境データ転送">
            <p>
              前項のとおり、本サービスは米国に拠点を置く事業者を利用しています。そのため、
              ユーザーの個人情報および本サービスに入力された情報は、日本国外
              (主に米国) のデータセンターで処理・保存される可能性があります。
            </p>
            <p>
              当サービスは、これらの事業者が個人情報保護のために適切な安全管理措置を
              講じていることを利用開始時およびその後定期的に確認します。
            </p>
          </LegalSection>

          <LegalSection number={6} title="Cookie および類似技術">
            <p>
              当サービスは、本サービスの提供のために以下の用途で Cookie および
              ローカルストレージ等の類似技術を利用します。
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                認証セッションの維持 (Supabase Auth が発行する認証 Cookie)
              </li>
              <li>
                ユーザーの作業状態の保持 (志望理由書下書き、自己分析回答、面接記録等の
                ローカルストレージ保存)
              </li>
              <li>サービスの基本的な動作維持に必要な技術的識別子</li>
            </ul>
            <p>
              当サービスは、広告配信および第三者によるトラッキングを目的とした Cookie を
              使用していません。
            </p>
            <p>
              ユーザーは、ブラウザの設定により Cookie の受け入れを拒否することができます。
              ただし、その場合は本サービスの一部機能 (ログイン、購読状態の同期、入力内容
              の保持等) が正常に動作しない可能性があります。
            </p>
          </LegalSection>

          <LegalSection number={7} title="情報の保存期間">
            <p>
              当サービスは、取得した情報を本サービスの提供および各利用目的の達成に必要な
              期間、保存します。具体的な目安は以下のとおりです。
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>アカウント情報・メールアドレス</strong>: アカウントが有効である期間
              </li>
              <li>
                <strong>購読状態 (subscriptions)</strong>: アカウントが有効である期間
                (解約後も契約履歴として保存)
              </li>
              <li>
                <strong>利用履歴 (AI 利用回数等)</strong>: 課金集計および品質分析の目的で
                取得から 24 ヶ月程度を目安に保存
              </li>
              <li>
                <strong>ユーザーが入力した文章</strong>: ユーザーがアカウントを利用して
                いる期間、ブラウザ側のローカルストレージおよびサーバ側のデータベースに保存
              </li>
              <li>
                <strong>決済情報</strong>: Stripe, Inc. 側で同社のポリシーおよび関連法令
                (税務、会計、不正利用調査等) に従い保存
              </li>
              <li>
                <strong>アクセスログ</strong>: 不具合調査・不正利用調査の目的で取得から
                12 ヶ月程度を目安に保存
              </li>
            </ul>
            <p>
              ユーザーから第 9 条に基づく削除請求があった場合、合理的な期間内に削除を
              行います。ただし、法令上の保管義務がある情報、または不正利用調査のために
              必要な情報については、所定の期間保管することがあります。
            </p>
          </LegalSection>

          <LegalSection number={8} title="安全管理措置">
            <p>
              当サービスは、取得した個人情報の漏えい、滅失、毀損を防止するため、以下の
              措置を講じます。
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>通信の暗号化 (HTTPS / TLS)</li>
              <li>
                データベースへのアクセス制御 (Row Level Security による所有者単位の
                データアクセス制限)
              </li>
              <li>
                決済情報のサーバ非保持 (カード情報は Stripe が直接取得・処理)
              </li>
              <li>業務委託先の安全管理水準の継続的な確認</li>
              <li>システムの定期的な保守・更新および脆弱性対応</li>
              <li>運営側担当者へのアクセス権限の最小化</li>
            </ul>
          </LegalSection>

          <LegalSection
            number={9}
            title="ユーザーの権利 (開示・訂正・削除・利用停止)"
          >
            <p>
              ユーザーは、当サービスに対し、ご自身の個人情報について以下の請求を行う
              ことができます。
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>取得している情報の開示請求</li>
              <li>内容に誤りがある場合の訂正、追加、削除請求</li>
              <li>個人情報の利用停止または消去の請求</li>
              <li>第三者への提供の停止請求</li>
            </ul>
            <p>
              請求は、第 11 条のお問い合わせ窓口までご連絡ください。本人確認を行ったうえで、
              法令およびシステム上の可能な範囲で合理的な期間内に対応します。請求対応に
              伴い、本サービスの一部機能の利用に制限が生じる場合があります。
            </p>
            <p className="text-xs text-slate-500">
              なお、AI 機能 (Anthropic Claude) に過去送信した内容についてのデータ削除は、
              当サービスのデータベースから削除を行うとともに、委託先事業者の規約および
              技術仕様に従って削除依頼を行います。
            </p>
          </LegalSection>

          <LegalSection number={10} title="未成年者の利用">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-2">
              <p className="text-sm text-amber-900 leading-relaxed">
                本サービスは大学受験を中心とした対象層を想定しており、高校生をはじめとする
                未成年者の利用が想定されます。
              </p>
            </div>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                未成年者が本サービスを利用する場合は、法定代理人 (保護者) の同意を
                得たうえで利用してください。
              </li>
              <li>
                法定代理人は、本ポリシーおよび利用規約の内容を未成年者に代わって確認し、
                同意したものとみなします。
              </li>
              <li>
                有料プランの契約は、法定代理人の同意を得たうえで未成年者本人または
                法定代理人が行ってください。同意なき契約が判明した場合、当サービスは
                ご連絡のうえ契約を解除することがあります。
              </li>
            </ol>
          </LegalSection>

          <LegalSection number={11} title="お問い合わせ窓口">
            <p>
              本ポリシーおよび個人情報の取扱いに関するお問い合わせ、第 9 条に基づく
              ユーザーの権利行使の請求は、以下までご連絡ください。
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
              <p className="font-semibold text-slate-900 mb-1">
                PASSAI 運営チーム
              </p>
              <p className="text-slate-600 leading-relaxed">
                お問い合わせフォームおよび専用連絡先は準備中です。整備までの間は、サイト
                上の最新の案内をご確認ください。
              </p>
            </div>
          </LegalSection>

          <LegalSection number={12} title="本ポリシーの改定">
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                当サービスは、法令の改正、サービス内容の変更、業務委託先の変更、その他
                必要に応じて本ポリシーを改定することがあります。
              </li>
              <li>
                本ポリシーを改定する場合、当サービスは改定後の内容および効力発生日を、
                本サービス内またはお知らせページにて告知します。
              </li>
              <li>
                効力発生日以降のユーザーによる本サービスの利用は、改定後の本ポリシーに
                同意したものとみなします。
              </li>
            </ol>
          </LegalSection>
        </div>

        <p className="text-xs text-slate-500 mt-12">以上</p>
      </div>
    </div>
  );
}
