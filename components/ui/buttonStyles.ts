// PASSAI Design System v1 — Button / LinkButton 共有スタイル
//
// 既存の sm / md / lg は完全維持（rounded-xl / 色も同等値）。
// 追加した hero / cta は LP 主役 CTA・料金カード用。
//
// 設計上の注意:
//   - rounded-* はサイズごとに個別指定（hero=2xl / cta=3xl）。
//     そのため BUTTON_BASE からは rounded を外し、各 size に持たせる。
//     既存の sm/md/lg にも rounded-xl を明示し、視覚は不変。
//   - primary / accent の色は @theme の brand-* / accent-* トークン経由。
//     値は Tailwind blue-600 / indigo-600 と同等のため、
//     既存 bg-blue-600 直書きから差し替えても視覚差は出ない。
//   - 緑系ボタンは原則使わない（プロダクト全体で青系に統一）。

export type ButtonVariant =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'hero' | 'cta';

export const BUTTON_BASE =
  'inline-flex items-center justify-center font-medium disabled:opacity-50 disabled:pointer-events-none';

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-brand-600 text-white hover:bg-brand-700 transition-colors',
  accent:    'bg-accent-600 text-white hover:bg-accent-700 transition-colors',
  secondary: 'bg-white text-slate-700 border border-gray-200 hover:bg-gray-50 transition-colors',
  outline:   'border border-brand-200 text-brand-700 bg-white hover:bg-brand-50 transition-colors',
  ghost:     'text-slate-600 hover:bg-slate-50 transition-colors',
  danger:    'border border-red-200 text-red-700 bg-white hover:bg-red-50 transition-colors',
};

export const BUTTON_SIZE: Record<ButtonSize, string> = {
  // 既存サイズ（rounded-xl / padding は不変）
  sm: 'rounded-xl text-xs px-3 py-1.5',
  md: 'rounded-xl text-sm px-6 py-2.5',
  lg: 'rounded-xl text-base px-6 py-3',

  // 追加サイズ
  // hero: LP / Home 上部の大きめ CTA。控えめな shadow。
  hero: 'rounded-2xl text-base sm:text-lg px-8 py-3.5 sm:py-4 shadow-sm',
  // cta:  料金カード / 主役の 1 本。ブランド色を帯びた強い影 + 軽い lift。
  cta:  'rounded-3xl text-base sm:text-lg px-8 sm:px-10 py-4 sm:py-5 shadow-cta hover:shadow-pop hover:-translate-y-0.5 transition-all duration-200',
};
