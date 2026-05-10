import { Card } from '@/components/ui/Card';

// 高校生が「自分のことだ」と思える共感セクション。
// 3 ブロック構成：
//   1) 悩みリスト（白カード内のチェックリスト）
//   2) このまま出すとどうなるか（淡いオレンジの注意喚起）
//   3) 解決メッセージ（青アクセントのカード）
// ネガティブで煽りすぎず、最終的に PASSAI への自然な動機づけに着地させる。
//
// PainItem        … 共感したいときに「自分も」と思える悩み行（チェックリスト風）
// ConsequenceItem … 注意喚起ブロック内の「このまま出すと…」の各帰結行

function PainItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3">
      {/* 空のチェックボックス：読者が脳内で「これ自分だ」とチェックする想定 */}
      <span
        aria-hidden="true"
        className="mt-1 w-5 h-5 rounded-md ring-1 ring-slate-300 bg-white shrink-0"
      />
      <span className="text-sm sm:text-base text-slate-800 leading-relaxed">
        {text}
      </span>
    </li>
  );
}

function ConsequenceItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 leading-relaxed">
      <span aria-hidden="true" className="text-orange-600 font-bold shrink-0 mt-0.5">
        ×
      </span>
      <span>{text}</span>
    </li>
  );
}

export function ProblemSection() {
  return (
    <section id="recommend" className="bg-slate-50 border-y border-slate-200">
      <div className="mx-auto max-w-3xl px-6 sm:px-8 py-14 sm:py-20">
        <div className="text-center mb-10 sm:mb-12">
          <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-3">
            こんな悩みがある人に
            <br className="sm:hidden" />
            おすすめです
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            総合型選抜・学校推薦型選抜は、才能やセンスだけで決まるものではありません。
            <br className="hidden sm:inline" />
            必要なのは、自分の経験を整理して、伝わる形にすることです。
          </p>
        </div>

        {/* 悩みリスト（白カード内に 7 項目） */}
        <Card padding="none" className="p-5 sm:p-7 mb-6 sm:mb-8">
          <ul className="grid gap-3 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-3">
            <PainItem text="何を書けばいいか分からない" />
            <PainItem text="とりあえず書いたけど「浅い」と言われた" />
            <PainItem text="自己分析のやり方が分からない" />
            <PainItem text="例文を見ても、自分に当てはまらない" />
            <PainItem text="添削に出しても「もっと具体的に」で終わる" />
            <PainItem text="書き直しても、何が良くなったか分からない" />
            <PainItem text="一般受験と並行して、短時間で対策したい" />
          </ul>
        </Card>

        {/* このまま出すとどうなるか（淡いオレンジの注意喚起） */}
        <div className="bg-orange-50 ring-1 ring-orange-200 rounded-2xl p-5 sm:p-7 mb-6 sm:mb-8">
          <p className="text-sm sm:text-base font-bold text-orange-900 mb-3">
            このまま出すと、
          </p>
          <ul className="space-y-2 text-sm sm:text-base text-orange-900">
            <ConsequenceItem text="中身が薄いまま提出してしまう" />
            <ConsequenceItem text="面接で深掘りされて止まる" />
            <ConsequenceItem text="「考えが浅い」と判断される" />
          </ul>
        </div>

        {/* 解決メッセージ（青アクセントカード） */}
        <div className="bg-white rounded-2xl ring-1 ring-brand-200 shadow-sm p-6 sm:p-8 text-center">
          <p className="text-base sm:text-xl font-extrabold leading-relaxed mb-4">
            でも、これは
            <span className="text-brand-600">センスの問題ではありません。</span>
            <br />
            やり方を知らないだけです。
          </p>
          <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
            PASSAIは、質問に答えながら活動整理・自己分析・志望理由書・面接対策まで進められるように作られています。
          </p>
        </div>
      </div>
    </section>
  );
}
