import { LinkButton } from '@/components/ui/LinkButton';

// LP 内で最も強い CTA。淡い青〜紫のグラデで「光の差すゾーン」を作り、
// rounded-3xl + shadow-lg + 軽い hover lift で押したくなる雰囲気を出す。
// 診断は外部サービスのため、target="_blank" + rel="noopener noreferrer" で別タブ。
// 余白を広めに（py-16 sm:py-24）、最大幅を抑えて視線が真ん中に集まる構成。

function DiagnosisPoint({ text }: { text: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 bg-white/80 ring-1 ring-accent-100 rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold text-accent-700 shadow-sm">
      <svg
        viewBox="0 0 20 20"
        className="w-3.5 h-3.5 text-accent-500 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 10l4 4 8-8" />
      </svg>
      <span>{text}</span>
    </li>
  );
}

export function FreeDiagnosisCtaSection() {
  return (
    <section className="relative overflow-hidden">
      {/* 淡い青〜紫のグラデ背景 */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-50 via-accent-50 to-purple-50"
      />
      <div className="mx-auto max-w-3xl px-6 sm:px-8 py-16 sm:py-24 text-center">
        <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-4">
          まずは無料で、
          <br className="sm:hidden" />
          自分の受験タイプを知ってみませんか？
        </h2>
        <p className="text-sm sm:text-base text-slate-700 leading-relaxed mb-8">
          30秒の質問に答えるだけで、
          <br className="sm:hidden" />
          あなたの総合型選抜タイプと、向いている対策スタイルが分かります。
        </p>

        {/* 5 つのポイント（ピル型） */}
        <ul className="flex flex-wrap justify-center gap-2 sm:gap-2.5 mb-10 sm:mb-12">
          <DiagnosisPoint text="無料で使える" />
          <DiagnosisPoint text="30秒で終わる" />
          <DiagnosisPoint text="登録不要" />
          <DiagnosisPoint text="一般受験との相性も分かる" />
          <DiagnosisPoint text="自分に合う対策タイプが見える" />
        </ul>

        {/* メイン CTA ボタン（内部 /diagnosis へ） */}
        <LinkButton
          href="/diagnosis"
          variant="accent"
          size="cta"
          className="w-full sm:w-auto font-bold"
        >
          無料で受験タイプ診断をする
          <span aria-hidden="true" className="ml-2">→</span>
        </LinkButton>

        {/* 補足メッセージ */}
        <p className="mt-5 sm:mt-6 text-xs sm:text-sm text-slate-600 leading-relaxed">
          「何を書けばいいか分からない」
          <br className="sm:hidden" />
          そんな状態から始める人のための診断です。
        </p>
      </div>
    </section>
  );
}
