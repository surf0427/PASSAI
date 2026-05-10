// FAQ は <details>/<summary> をそのまま使う。JS なしで開閉が動き、
// Tailwind の group-open:rotate-180 だけでシェブロンを反転させる。
// 質問文・回答文は LP からのコピー編集が見やすいよう配列で集中管理。

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: '本当に何も書けない状態から使えますか？',
    a: 'はい、問題ありません。\nPASSAIは「何を書くか分からない状態」からスタートする前提で作られています。\n質問に答えていくだけで、活動整理・自己分析・志望理由書まで順番に進められます。',
  },
  {
    q: 'AIが全部書いてくれるんですか？',
    a: 'いいえ、書くのはあなたです。\nPASSAIは“答えを出すツール”ではなく、“考えを引き出すツール”です。\nそのため、面接でも答えられる「自分の言葉」で書けるようになります。',
  },
  {
    q: '添削だけのサービスと何が違うんですか？',
    a: '多くのサービスは「書いた後の添削」が中心ですが、PASSAIは活動整理・自己分析・深掘り・志望理由書・小論文・面接対策まで一貫してつながっています。\nだから、途中で何をすればいいか分からなくなりにくい設計です。',
  },
  {
    q: '一般受験と並行でも使えますか？',
    a: 'はい、使えます。\n短時間でも進められるように設計しているため、一般受験の勉強をしながらでも総合型・学校推薦型の対策を進められます。',
  },
  {
    q: '個人情報は大丈夫ですか？',
    a: '個人情報が公開されることはありません。\nランキング機能などを使う場合も、表示されるのはユーザー名のみで、実名や個人情報は公開されません。',
  },
  {
    q: '途中で解約できますか？',
    a: 'はい、正式リリース時にはマイページから解約できる設計にする予定です。\n料金や解約方法の詳細は、リリース時に分かりやすく案内します。',
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
      <summary className="list-none flex items-start gap-3 cursor-pointer p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
        <span className="flex-1 font-bold text-slate-900 text-sm sm:text-base leading-relaxed">
          {q}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-brand-600 transition-transform duration-200 group-open:rotate-180"
        >
          <svg
            viewBox="0 0 20 20"
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 8l5 5 5-5" />
          </svg>
        </span>
      </summary>
      <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-4 sm:pt-5 border-t border-slate-100">
        <p className="text-sm sm:text-base text-slate-700 leading-relaxed whitespace-pre-line">
          {a}
        </p>
      </div>
    </details>
  );
}

export function FaqSection() {
  return (
    <section id="faq" className="bg-slate-50 border-y border-slate-200">
      <div className="mx-auto max-w-3xl px-6 sm:px-8 py-14 sm:py-20">
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight mb-3">
            よくある質問
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            使う前に気になる不安をまとめました。
          </p>
        </div>

        <div className="space-y-3 sm:space-y-4">
          {FAQ_ITEMS.map((item) => (
            <FAQItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </section>
  );
}
