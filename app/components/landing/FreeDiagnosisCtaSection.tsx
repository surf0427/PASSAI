import Link from 'next/link';
import {
  BUTTON_BASE,
  BUTTON_VARIANT,
  BUTTON_SIZE,
} from '@/components/ui/buttonStyles';

// LP「⑥ 無料の受験タイプ診断」セクション。「無料で試せる入口」として、
// 有料プラン CTA とは別物の、最も気軽に押せる CTA を提供する。
// 淡い青〜紫のグラデで「光の差すゾーン」を作り、rounded-3xl + shadow-cta +
// 軽い hover lift（cta size）で押したくなる雰囲気を出す。
// 余白を広めに（py-16 sm:py-24）、最大幅を抑えて視線が真ん中に集まる構成。
// legacy 4タイプ / 9タイプの分岐は /diagnosis 側 flag に委ね、ここは遷移のみ。
//
// STEP-DIAGNOSIS-CTA-02: CTA は LinkButton ラッパを介さず next/link の <Link> を
// 直接使い、確実に <a href="/diagnosis"> を出力する（クリック不能バグの恒久対策）。
// 見た目は LinkButton と同じ buttonStyles 定数を当てて完全一致させる。
// 装飾用グラデ背景は aria-hidden かつ pointer-events-none にして、万一の
// z-index 解決ずれでも CTA のクリックを絶対に奪わないようにする。

export function FreeDiagnosisCtaSection() {
  return (
    <section className="relative overflow-hidden">
      {/* 淡い青〜紫のグラデ背景（装飾のみ・クリックを奪わない） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-brand-50 via-accent-50 to-purple-50"
      />
      <div className="mx-auto max-w-3xl px-6 sm:px-8 py-16 sm:py-24 text-center">
        {/* サブ見出し */}
        <p className="inline-block text-xs sm:text-sm font-bold text-accent-700 bg-white/80 ring-1 ring-accent-100 rounded-full px-4 py-1.5 mb-5 shadow-sm">
          まずは無料で試してください
        </p>

        {/* 見出し */}
        <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-5">
          無料の受験タイプ診断
        </h2>

        {/* 本文 */}
        <p className="text-sm sm:text-base text-slate-700 leading-relaxed mb-10 sm:mb-12">
          あなたの受験タイプが分かる。
          <br />
          向いている対策が分かる。
          <br />
          30秒で終わります。
        </p>

        {/* メイン CTA（next/link の <Link> を直接使用 → 確実に <a href="/diagnosis">）。
            class は LinkButton(accent / cta) と同一の buttonStyles 定数で見た目を揃える。 */}
        <Link
          href="/diagnosis"
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.accent} ${BUTTON_SIZE.cta} w-full sm:w-auto font-bold`}
        >
          無料で受験タイプ診断を受ける
          <span aria-hidden="true" className="ml-2">→</span>
        </Link>
      </div>
    </section>
  );
}
