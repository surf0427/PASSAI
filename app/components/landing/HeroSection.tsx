// FREEZE(legacy-diagnosis): ヒーローの主 CTA は 4 タイプ診断（/diagnosis）への
// 導線だったため凍結中。CTA 非表示に伴い LinkButton は未使用となるため import も停止。
// import { LinkButton } from '@/components/ui/LinkButton';

import Image from 'next/image';

// First View（ヒーロー）。
// PC: 左右 2 カラム（左=テキスト / 右=画像）、スマホ: テキストの下に画像。
// 淡い青→白のグラデ背景。右の画像は角丸＋軽いシャドウ。
// 画像は public/hero-passai-interview.png（将来 PC 画面部分のみ実 UI へ差し替え予定）。
// CLS 対策として width/height を明示し、h-auto w-full で縦横比を保持する。

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* 淡い青→白のグラデ背景 */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white"
      />
      <div className="mx-auto max-w-6xl px-6 sm:px-8 pt-10 sm:pt-16 pb-14 sm:pb-20">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* 左：テキスト（スマホは中央寄せ / PC は左寄せ） */}
          <div className="text-center lg:text-left">
            <p className="inline-block text-xs sm:text-sm font-semibold text-brand-700 bg-brand-100 rounded-full px-3 py-1 mb-6">
              総合型選抜・学校推薦型選抜のためのAI受験サポート
            </p>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-5">
              何も書けない状態から、
              <br className="sm:hidden" />
              合格レベルまで持っていく。
            </h1>
            <p className="text-base sm:text-lg text-slate-700 leading-relaxed mb-4">
              活動整理・自己分析・志望理由書・小論文・面接まで、
              <br className="hidden sm:inline" />
              1つの流れで全部つながるAI受験サポート。
            </p>
            <p className="text-sm text-slate-500 leading-relaxed">
              総合型選抜・学校推薦型選抜に必要な準備を、
              <br className="sm:hidden" />
              質問に答えながら順番に進められます。
            </p>

            {/* FREEZE(legacy-diagnosis): ヒーローの主 CTA は /diagnosis（4 タイプ診断）へ
                の導線だったため凍結中。正式版（juken-shindan 9 タイプ）接続時に差し替える。
            <div className="mt-8 sm:mt-10">
              <LinkButton
                href="/diagnosis"
                variant="primary"
                size="hero"
                className="font-bold"
              >
                無料で受験タイプ診断をする
                <span aria-hidden="true" className="ml-2">→</span>
              </LinkButton>
              <p className="mt-3 text-xs text-slate-500">
                30秒・無料・登録不要
              </p>
            </div>
            */}
          </div>

          {/* 右：ヒーロー画像（角丸＋軽いシャドウ。画像上に文字は重ねない） */}
          <div className="lg:justify-self-end">
            <Image
              src="/hero-passai-interview.png"
              alt="PASSAIのAI面接練習を自宅で利用する受験生"
              width={1536}
              height={1024}
              preload
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="h-auto w-full rounded-2xl shadow-lg ring-1 ring-black/5 lg:w-[88%]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
