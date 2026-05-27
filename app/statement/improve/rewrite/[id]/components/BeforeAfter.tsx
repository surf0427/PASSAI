// 軸別 Before / After 例示の表示。STEP-PAGE-03 で page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure props rendering。example を受け取って Before / After の 2 ブロックと hint を表示するだけ。
//   軸ごとの「具体的にどう書き換えればよいか」を 1 例だけ提示する。
//   縦並びの 2 ブロック + 区切り線 1 本。色付き Card にせず、subtle な背景で「変化」を見せる。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state
//
// AxisExample 型は page.tsx 側の正本と structurally identical な型を本ファイル内に duplicate する。
// 共通 type ファイル化は本 STEP の禁止事項（self-contained 維持）。

'use client';

type AxisExample = {
  before: string;
  after: string;
  hint: string;
};

export function BeforeAfter({ example }: { example: AxisExample }) {
  // UI polish: Before は muted（slate）、After は subtle positive（violet）に振り分けて
  // 「変化」を色のトーンで示す。card 全体は bg-slate-50 で控えめに、内部の After 区画にだけ
  // 微弱な violet tint を当てる。
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-4 sm:px-5 sm:py-5">
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Before
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          「{example.before}」
        </p>
      </div>
      <div className="rounded-md bg-violet-50/60 border-l-2 border-violet-300 px-3 py-2.5 mb-3">
        <p className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider mb-1.5">
          After
        </p>
        <p className="text-sm text-slate-800 leading-relaxed">
          「{example.after}」
        </p>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        ヒント：{example.hint}
      </p>
    </div>
  );
}
