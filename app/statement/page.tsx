import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

// STEP 35: 「添削ツール」ではなく「0 から完成まで導く伴走型ツール」が伝わる構成へ。
// 動的データを持たないので Server Component のまま。
const USAGE_STEPS: { title: string; body: string }[] = [
  {
    title: 'まずは書ける範囲で OK',
    body: '最初から完璧に書く必要はありません。短くてもいいので、今ある経験や興味を書いてみましょう。',
  },
  {
    title: '書けない場合は AI がヒントを出す',
    body: '「何を書けばいいかわからない」という場合は、AI が経験・興味・将来像を整理しながら、考えるヒントを出します。',
  },
  {
    title: 'AI 添削で現在地を確認',
    body: '添削をすると、完成度・大学との一致度・合格ラインとの差分などが表示されます。',
  },
  {
    title: '改善ポイントを確認',
    body: '「どこを直せばいいか」「何が不足しているか」を AI が整理して表示します。',
  },
  {
    title: '修正して再添削',
    body: '改善ポイントを見ながら修正し、再添削することで完成度を上げていけます。',
  },
];

export default function StatementEntryPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <header className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
          志望理由書を仕上げる
        </h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
          何から書けばいいかわからなくても大丈夫です。AI があなたの経験・興味・将来像を整理しながら、志望理由書を完成までサポートします。
        </p>
      </header>

      {/* ── 使い方ガイド ─────────────────────────────────── */}
      <section className="mb-6 sm:mb-8">
        <Card className="bg-blue-50 border-blue-100">
          <h2 className="text-base sm:text-lg font-bold text-blue-900 mb-3">
            この機能でできること
          </h2>
          <p className="text-sm text-slate-700 leading-relaxed mb-6">
            この機能では、「まだ何を書けばいいかわからない人」でも、AI のヒントを使いながら志望理由書を書き始められます。書いた後は、完成度・大学との一致度・合格ラインとの差分を確認しながら、改善ポイントを整理できます。
          </p>

          <ol className="space-y-5 sm:space-y-6 mb-6 list-none">
            {USAGE_STEPS.map((s, i) => (
              <li key={i}>
                <p className="text-[11px] font-bold text-blue-700 mb-1 tracking-widest">
                  STEP {i + 1}
                </p>
                <p className="text-sm sm:text-base font-bold text-slate-900 mb-1.5">
                  {s.title}
                </p>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>

          <div className="border-t border-blue-100 pt-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              AI が志望理由書を代わりに完成させる機能ではありません。自分で書いた内容をもとに、考えを整理しながら改善していくためのサポート機能です。
            </p>
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* ── 選択肢 1：下書きを添削する ─────────── */}
        <Card className="flex flex-col">
          <p className="text-[11px] font-bold text-blue-600 mb-2 tracking-widest">
            選択肢 1
          </p>
          <h2 className="text-lg font-bold text-slate-900 mb-3">
            すでに下書きがある
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-6 flex-1">
            書いた志望理由書をそのまま添削できます。
          </p>
          <LinkButton
            href="/statement/edit"
            variant="primary"
            size="md"
            className="w-full"
          >
            下書きを添削する
          </LinkButton>
        </Card>

        {/* ── 選択肢 2：書く内容を整理する ─────────── */}
        <Card className="flex flex-col">
          <p className="text-[11px] font-bold text-blue-600 mb-2 tracking-widest">
            選択肢 2
          </p>
          <h2 className="text-lg font-bold text-slate-900 mb-3">
            まだ何を書けばいいかわからない
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-6 flex-1">
            AI と一緒に、経験・興味・将来像を整理してから書き始めます。
          </p>
          <LinkButton
            href="/statement/prepare"
            variant="secondary"
            size="md"
            className="w-full"
          >
            書く内容を整理する
          </LinkButton>
        </Card>
      </div>
    </div>
  );
}
