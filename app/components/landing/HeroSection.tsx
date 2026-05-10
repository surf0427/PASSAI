import { LinkButton } from '@/components/ui/LinkButton';

// First View（ヒーロー：メインコピー / サブコピー / 補足）。
// 淡い青→白のグラデ背景、中央寄せ、セカンダリ CTA は控えめ 1 本。

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* 淡い青→白のグラデ背景 */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white"
      />
      <div className="mx-auto max-w-3xl px-6 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 text-center">
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

        {/* セカンダリ CTA：ヒーロー段階での離脱を抑えるため軽めに 1 本だけ。
            Pricing / Free Diagnosis の主役 CTA より控えめに：
              - size="hero"（主役は size="cta"）
              - shadow-sm（主役は shadow-cta + hover lift）
              - variant="primary"（主役は variant="accent"）
            「無料・30秒・登録不要」を一瞬で伝えるトーン。 */}
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
      </div>
    </section>
  );
}
