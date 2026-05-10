import Link from 'next/link';
import { Logo } from '@/app/components/Logo';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

// ── PASSAI ランディングページ（LP / トップページ） ─────────────────
// セクション構成：
//   1. Header（グローバル Header が LP 用変種を表示。app/components/Header.tsx 参照）
//   2. First View（ヒーロー：メインコピー / サブコピー / 補足）
//   3. For You / Pain Points（こんな人におすすめ：悩み → 警告 → 解決）
//   4. Feature Flow（機能の流れ：6 ステップを番号付きカードで表示）
//   5. Pricing（料金プラン比較：2 カード + 注意書き）
//   6. Compare（他社比較：PDF 比較資料の 8 項目で「向いている人の違い」として提示）
//   7. Free Diagnosis CTA（無料受験タイプ診断への強めの CTA）
//   8. FAQ（よくある質問：<details> ベースの開閉式・JS なし）
//   9. Closing Message + Final CTA（締めの本文 + メイン/サブ CTA）
//  10. Footer（LP 内 footer：ブランド + 法的リンク列 + コピーライト）
//      ※ 他ページに出さないため、グローバル layout ではなく LP 内に配置する。
//
// 設計方針：
//   - スマホ最優先（max-w を抑え、px-6 で余白を確保）
//   - ボタンは大きめ（py-4 / text-base 以上）
//   - 白ベース + blue-600 / indigo-500 のアクセント
//   - rounded-2xl + shadow-sm + 淡い背景（slate-50 / blue-50）
//   - セクションは <section> で並列に並べる前提（今後の追加に備える）

export default function LandingPage() {
  return (
    <div className="bg-white text-slate-900">
      {/* ── First View ─────────────────────────────────────────── */}
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

      {/* ── For You / Pain Points ──────────────────────────────── */}
      {/* 高校生が「自分のことだ」と思える共感セクション。
          3 ブロック構成：
            1) 悩みリスト（白カード内のチェックリスト）
            2) このまま出すとどうなるか（淡いオレンジの注意喚起）
            3) 解決メッセージ（青アクセントのカード）
          ネガティブで煽りすぎず、最終的に PASSAI への自然な動機づけに着地させる。 */}
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

      {/* ── Feature Flow ───────────────────────────────────────── */}
      {/* 6 ステップを番号付きカードで提示。
          スマホ：1列／タブレット：2列／PC：3列のグリッド。
          番号バッジ自体が「流れ」の可読性を担保するため、矢印類は省略。 */}
      <section id="features" className="bg-white">
        <div className="mx-auto max-w-5xl px-6 sm:px-8 py-14 sm:py-20">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-3">
              PASSAIは、合格までの準備が
              <br className="sm:hidden" />
              1つの流れでつながる
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              活動整理から自己分析、志望理由書、小論文、面接対策まで。
              <br className="hidden sm:inline" />
              バラバラに対策するのではなく、入力した内容を次の対策に活かしながら進められます。
            </p>
          </div>

          <ol className="grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <StepCard
              num="01"
              title="活動整理"
              desc={
                '部活・留学・ボランティア・アルバイトなど、今までの経験を質問に答えるだけで整理。\n\n' +
                '「何を書けばいいか分からない」状態でも、AIがヒントを出しながら、面接や志望理由書で使える形にまとめます。'
              }
              tags={['#経験整理', '#AIヒント', '#面接につながる']}
            />
            <StepCard
              num="02"
              title="自己分析"
              desc={
                '活動整理の内容をもとに、AIが「なぜその行動をしたのか」を深掘り。\n\n' +
                '自分では気づかなかった強みや、面接で聞かれやすいポイントも整理できます。'
              }
              tags={['#AI深掘り', '#強み分析', '#面接対策']}
            />
            <StepCard
              num="03"
              title="志望校マッチング"
              desc={
                '活動内容・自己分析・志望理由をもとに、大学ごとの相性をAIが分析。\n\n' +
                '「今のままだと何が足りないか」「どこを改善すれば近づけるか」まで確認できます。'
              }
              tags={['#大学分析', '#改善ポイント', '#相性診断']}
            />
            <StepCard
              num="04"
              title="志望理由書支援"
              desc={
                'いきなり志望理由書を書かせません。\n\n' +
                'まずはAIとの質問形式で、「なぜその大学に行きたいのか」を整理。\n\n' +
                'その後、大学との一致・具体性・説得力を見ながら添削します。'
              }
              tags={['#AI添削', '#大学一致', '#具体性UP']}
            />
            <StepCard
              num="05"
              title="小論文支援"
              desc={
                '大学ごとのテーマ傾向をもとに、考え方・構成・書き方を整理。\n\n' +
                'AIが「弱い主張」や「足りない視点」を確認しながら、小論文を書き進められます。'
              }
              tags={['#構成サポート', '#大学別対策', '#視点整理']}
            />
            <StepCard
              num="06"
              title="面接練習"
              desc={
                '活動内容や志望理由書をもとに、大学ごとの予想質問を生成。\n\n' +
                '回答後は、「浅い部分」「伝わりにくい部分」をAIがフィードバックします。'
              }
              tags={['#予想質問', '#AIフィードバック', '#深掘り対策']}
            />
          </ol>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      {/* 2 プラン比較カード（ベーシック / プレミアム）。
          プレミアムは ring-accent-500 + 「おすすめ」フローティングバッジで強調。
          Stripe / 認証は未実装。CTA はいったん /home へ仮リンク。 */}
      <section id="pricing" className="bg-slate-50 border-y border-slate-200">
        <div className="mx-auto max-w-4xl px-6 sm:px-8 py-14 sm:py-20">
          <div className="text-center mb-12 sm:mb-14">
            <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight mb-3">
              料金プラン
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              まずは必要な機能から始めて、
              <br className="sm:hidden" />
              対策量に合わせてプランを選べます。
            </p>
          </div>

          {/* 機能リストは Feature Flow の 6 機能と完全一致 → 視覚的に「全部入り」と分かる */}
          <div className="grid gap-6 sm:gap-5 sm:grid-cols-2">
            <PricingCard
              name="ベーシックプラン"
              price="2,980"
              description="まずは総合型・学校推薦型の対策を一通り始めたい人向け。"
              features={[
                '活動整理',
                '自己分析',
                '志望校マッチング',
                '志望理由書支援',
                '小論文支援',
                '面接練習',
              ]}
              note="総合型・学校推薦型対策を、1つの流れで進められます。"
              ctaLabel="ベーシックで始める"
              ctaHref="/home"
            />
            <PricingCard
              name="プレミアムプラン"
              price="4,980"
              description="ベーシックの全機能 + 追加要素つきの上位プラン。"
              features={[
                '活動整理',
                '自己分析',
                '志望校マッチング',
                '志望理由書支援',
                '小論文支援',
                '面接練習',
              ]}
              extras={[
                'AI利用上限を大幅緩和予定',
                '今後の追加機能も優先対応予定',
              ]}
              note="より深く・高頻度で使いたい人向け。"
              ctaLabel="プレミアムで始める"
              ctaHref="/home"
              highlight
              badge="おすすめ"
            />
          </div>

          {/* 「全部入り感」を強調する補足メッセージ：
              料金カードと Feature Flow の繋がりを言語化し、
              「添削だけのサービスではない」ことを明示する */}
          <div className="mt-10 sm:mt-12 mx-auto max-w-2xl bg-white rounded-2xl ring-1 ring-brand-200 shadow-sm p-6 sm:p-8 text-center">
            <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
              PASSAIは、
              <br className="sm:hidden" />
              「添削だけ」ではなく、
              <br />
              <span className="text-brand-600 font-bold">
                活動整理から面接までを1つの流れで進める
              </span>
              ためのサービスです。
            </p>
          </div>

          <p className="mt-6 text-xs text-slate-500 text-center leading-relaxed">
            ※正式な利用回数や機能範囲は、リリース時に変更される場合があります。
          </p>
        </div>
      </section>

      {/* ── Compare ────────────────────────────────────────────── */}
      {/* 他社比較。攻撃的にならないよう「方向性の違い」として見せる。
          スマホ：各行で「比較ポイント」を上に置き、その下で 一般塾 / PASSAI を
          2 カラムで横並び（横スクロールなし）。
          PC：3 カラムの表（比較ポイント / 一般塾 / PASSAI）。
          PASSAI 列は bg-brand-50 + text-brand-700 + border-l-blue-100 で強調。 */}
      <section id="compare" className="bg-white">
        <div className="mx-auto max-w-4xl px-6 sm:px-8 py-14 sm:py-20">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-snug mb-3">
              PASSAIと一般的な
              <br className="sm:hidden" />
              総合型対策塾の違い
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              どちらが良い・悪いではなく、向いている人が違います。
              <br />
              PASSAIは、低価格で好きな時間に、自分のペースで対策を進めたい人向けのAI受験サポートです。
            </p>
          </div>

          {/* スマホ：1 項目 = 1 カード（PASSAI 上 / 一般塾 下） */}
          <div className="sm:hidden space-y-3">
            {COMPARE_DATA.map((row) => (
              <CompareCardMobile key={row.axis} row={row} />
            ))}
          </div>

          {/* PC：3 カラムの比較表（比較ポイント / 一般塾 / PASSAI） */}
          <Card padding="none" className="hidden sm:block overflow-hidden">
            <div className="grid grid-cols-[160px_1fr_1fr] bg-slate-50 border-b border-slate-200">
              <div className="px-4 py-3 text-xs font-bold text-slate-500 border-r border-slate-200 flex items-center">
                比較ポイント
              </div>
              <div className="px-4 py-3 text-xs font-bold text-slate-600 flex items-center">
                一般的な塾
              </div>
              <div className="px-4 py-3 text-xs font-bold text-brand-700 bg-brand-50/50 border-l border-brand-100 flex items-center">
                PASSAI
              </div>
            </div>
            {COMPARE_DATA.map((row) => (
              <CompareRowDesktop key={row.axis} row={row} />
            ))}
          </Card>

          {/* 注意書き：PDF 比較資料が情報源であることを明示 */}
          <p className="mt-6 text-xs text-slate-500 text-center leading-relaxed">
            ※比較内容は、公開情報およびアップロードされた比較資料をもとにした概算です。
            <br className="sm:hidden" />
            各サービスの料金・内容はコースや時期によって変動する場合があります。
          </p>

          {/* 最後のメッセージ */}
          <div className="mt-10 sm:mt-12 mx-auto max-w-2xl bg-white rounded-2xl ring-1 ring-brand-200 shadow-sm p-6 sm:p-8 text-center">
            <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
              PASSAIは、
              <br className="sm:hidden" />
              「最初から上手く書ける人」のためではなく、
              <br />
              <span className="text-brand-600 font-bold">
                「何から始めればいいか分からない人」のため
              </span>
              に作られています。
            </p>
          </div>
        </div>
      </section>

      {/* ── Free Diagnosis CTA ─────────────────────────────────── */}
      {/* LP 内で最も強い CTA。淡い青〜紫のグラデで「光の差すゾーン」を作り、
          rounded-3xl + shadow-lg + 軽い hover lift で押したくなる雰囲気を出す。
          診断は外部サービスのため、target="_blank" + rel="noopener noreferrer" で別タブ。
          余白を広めに（py-16 sm:py-24）、最大幅を抑えて視線が真ん中に集まる構成。 */}
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

      {/* ── FAQ ────────────────────────────────────────────────── */}
      {/* <details> をそのまま使った開閉式 FAQ。JavaScript の状態管理は不要。
          Tailwind の `group-open:rotate-180` でシェブロンを反転、
          `[&::-webkit-details-marker]:hidden` でデフォルト三角を隠す。
          法的断定や煽りを避けるため、解約や個人情報の文言は「予定」「公開されません」レベルに留める。 */}
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

      {/* ── Closing Message + Final CTA ────────────────────────── */}
      {/* LP の締め。FAQ で不安を解消した直後の「感情に残る最後の一押し」。
          上から indigo→blue→white にフェードする縦グラデで「光が差す」雰囲気を作り、
          中央寄せの本文 → メイン CTA（外部・別タブ）→ サブ CTA（有料サイト）で締める。
          Free Diagnosis CTA とのカニバリ回避のため、本文を厚めに、CTA は同色だがコンテキストで差別化。 */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-b from-accent-50 via-brand-50 to-white"
        />
        <div className="mx-auto max-w-2xl px-6 sm:px-8 py-16 sm:py-24 text-center">
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-snug mb-8 sm:mb-10 text-slate-900">
            迷っているうちに、
            <br className="sm:hidden" />
            時間だけが過ぎていく。
          </h2>

          {/* 本文：ユーザー指定の改行を <br /> でそのまま再現し、詩的なリズムを維持 */}
          <div className="space-y-5 text-sm sm:text-base text-slate-700 leading-relaxed mb-10 sm:mb-12">
            <p>
              総合型選抜・学校推薦型選抜は、
              <br />
              特別な才能がある人だけの入試ではありません。
            </p>
            <p>
              自分の経験を整理して、
              <br />
              なぜその大学で学びたいのかを言葉にして、
              <br />
              面接で自分の言葉で伝えられる人が強い入試です。
            </p>
            <p>
              PASSAIは、
              <br />
              何も書けない状態から始める人のために、
              <br />
              活動整理・自己分析・志望理由書・小論文・面接対策まで、
              <br />
              1つの流れで進められるように作られています。
            </p>
            <p className="font-semibold text-slate-800">
              まずは無料診断から、
              <br />
              自分に合う対策の始め方を見つけてください。
            </p>
          </div>

          {/* CTA：メインは内部 /diagnosis、サブは内部 /home */}
          <div className="flex flex-col gap-3 max-w-md mx-auto">
            <LinkButton
              href="/diagnosis"
              variant="accent"
              size="cta"
              className="font-bold"
            >
              無料で受験タイプ診断をする
              <span aria-hidden="true" className="ml-2">→</span>
            </LinkButton>
            {/* サブ CTA：cta size の主役と並ぶ控えめ 1 本。LinkButton size 体系に
                完全一致しないため（text-sm sm:text-base）、ここは Link のまま残し、
                次の PR で「subtle」size を追加するときに揃える。 */}
            <Link
              href="/home"
              className="inline-flex justify-center items-center bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-sm sm:text-base px-6 py-3 rounded-xl transition-colors"
            >
              有料サイトを見る
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      {/* LP 内 footer。グローバル layout には入れず、`/` でだけ表示する。
          スマホ：ブランド → リンク列 → コピーライト の縦並び。
          PC：ブランド（左）／リンク列（右）の左右配置 + 下にコピーライト。
          法的ページのリンク先（/about, /terms, /privacy, /contact）は未作成（仮）。 */}
      <footer className="bg-slate-50 border-t border-slate-200">
        <div className="mx-auto max-w-5xl px-6 sm:px-8 py-10 sm:py-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between sm:gap-12">
            {/* ブランド */}
            <div>
              <Logo />
              <p className="mt-3 text-xs sm:text-sm text-slate-500 leading-relaxed">
                総合型選抜・学校推薦型選抜のためのAI受験サポート
              </p>
            </div>

            {/* リンク列 */}
            <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link
                href="/about"
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                運営者情報
              </Link>
              <Link
                href="/terms"
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                利用規約
              </Link>
              <Link
                href="/privacy"
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                プライバシーポリシー
              </Link>
              <Link
                href="/contact"
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                お問い合わせ
              </Link>
            </nav>
          </div>

          {/* コピーライト */}
          <p className="mt-8 sm:mt-10 pt-6 border-t border-slate-200 text-xs text-slate-500 text-center sm:text-left">
            © 2026 PASSAI
          </p>
        </div>
      </footer>
    </div>
  );
}

// ── Pain Item / Consequence Item ────────────────────────────────
// For You / Pain Points セクション専用のローカル component。
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

// ── Step Card ───────────────────────────────────────────────────
// Feature Flow セクション専用のローカル component。
// 番号バッジ + タイトル + 多段落の説明文 + 下部にタグ pill。
// flex-col + 説明 flex-1 + タグ末尾固定の構造で、
// グリッド内の同じ行のカードどうしで「タグの位置」が揃う。
//
// 説明文は \n\n で段落区切り。CSS の whitespace-pre-line が空行を再現する。

type StepCardProps = {
  num: string;
  title: string;
  desc: string;
  tags: string[];
};

function StepCard({ num, title, desc, tags }: StepCardProps) {
  return (
    <li className="list-none flex flex-col bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 sm:p-7">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-brand-50 text-brand-700 text-sm font-extrabold tracking-tight">
          {num}
        </span>
        <p className="text-base sm:text-lg font-bold text-slate-900">{title}</p>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line mb-5 flex-1">
        {desc}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center bg-brand-50 text-brand-700 ring-1 ring-brand-100 rounded-full px-2.5 py-1 text-xs font-semibold"
          >
            {tag}
          </span>
        ))}
      </div>
    </li>
  );
}

// ── Diagnosis Point ─────────────────────────────────────────────
// Free Diagnosis CTA セクション専用のローカル component。
// 白半透明のピル型バッジ + 小さな ✓ アイコンで「軽くて押せる雰囲気」に。
// グラデ背景の上で浮き上がるよう ring と shadow-sm をうっすら添える。

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

// ── FAQ ─────────────────────────────────────────────────────────
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

// ── Compare 用データ + コンポーネント ────────────────────────────
// PDF「競合塾比較表 v8」の 8 項目を反映。
// スマホ：1 項目 = 1 カード（PASSAI 上 → 一般塾 下、項目ごとに視覚的に独立）。
// PC：3 カラムの表（比較ポイント / 一般塾 / PASSAI）。
// 「向いている人が違う」フレーミング：
//   - PASSAI 列は bg-brand-50/50 + 左ボーダーで軽く識別、テキスト色は同じ
//   - 一般塾の強み（手厚さ・実績・対面）も同等の重みで提示
//   - PASSAI の弱み（強制力弱め・対面なし・新規で実績収集中）も正直に書く

type CompareRowData = {
  axis: string;
  passai: string[];
  other: string[];
};

const COMPARE_DATA: CompareRowData[] = [
  {
    axis: '費用',
    passai: ['月額2,980円（年約3.6万円）', '入塾金0円'],
    other: ['年間約40〜100万円', '入塾金が必要な場合あり'],
  },
  {
    axis: '指導方法',
    passai: ['AI個別対応', '回数無制限'],
    other: ['講師マンツーマン / 集団授業 / 個別指導', '予約制・コマ数制'],
  },
  {
    axis: '学習サポート',
    passai: ['オンライン完結', '自分のペースで進める', '強制力は弱め'],
    other: ['講師が進捗管理', '対面で手厚くサポート', '仲間と切磋琢磨できる'],
  },
  {
    axis: '利用時間・形式',
    passai: ['24時間いつでも利用可', '完全オンライン'],
    other: ['営業時間内', 'オンライン＋通学 / 通学中心'],
  },
  {
    axis: '対象生徒',
    passai: ['総合型・学校推薦型', '一般受験生の推薦併願にも対応'],
    other: ['総合型・学校推薦型（推薦専願向けが中心）'],
  },
  {
    axis: '合格実績',
    passai: ['新規サービスのため、現在モニター生の実績を収集中'],
    other: ['難関大への合格実績が豊富'],
  },
  {
    axis: '向いている人',
    passai: [
      'コスパを重視したい',
      '好きな時間に進めたい',
      '推薦と一般で迷っている',
      '地方で塾がない',
    ],
    other: [
      '手厚い指導が欲しい',
      '対面でサポートを受けたい',
      '仲間と一緒に頑張りたい',
    ],
  },
  {
    axis: '向いていない人',
    passai: ['人に管理してほしい人', '対面でないと不安な人'],
    other: ['費用を抑えたい人', '自分のペースで進めたい人'],
  },
];

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-slate-700 leading-relaxed">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span aria-hidden="true" className="text-slate-400 shrink-0">
            ・
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CompareCardMobile({ row }: { row: CompareRowData }) {
  return (
    <Card padding="none" className="p-5">
      <p className="text-sm font-bold text-slate-700 mb-4">{row.axis}</p>
      <div>
        <p className="text-xs font-bold text-brand-700 mb-2">PASSAI</p>
        <BulletList items={row.passai} />
      </div>
      <div className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-xs font-bold text-slate-500 mb-2">一般的な塾</p>
        <BulletList items={row.other} />
      </div>
    </Card>
  );
}

function CompareRowDesktop({ row }: { row: CompareRowData }) {
  return (
    <div className="grid grid-cols-[160px_1fr_1fr] border-t border-slate-200">
      <div className="px-4 py-5 border-r border-slate-200 flex items-start">
        <span className="text-sm font-semibold text-slate-700 leading-relaxed">
          {row.axis}
        </span>
      </div>
      <div className="px-4 py-5">
        <BulletList items={row.other} />
      </div>
      <div className="px-4 py-5 bg-brand-50/50 border-l border-brand-100">
        <BulletList items={row.passai} />
      </div>
    </div>
  );
}

// ── Pricing Card ────────────────────────────────────────────────
// LP 内でのみ使用。プラン名 / 説明 / 価格 / 機能リスト / CTA をまとめて受け取り、
// プレミアム側は highlight + badge で「少し強調」する設計。
// 機能リストの拡張や Stripe 接続が入る STEP では components/Pricing/ に切り出す。

type PricingCardProps = {
  name: string;
  price: string;
  description: string;
  features: string[];     // 「含まれる機能」リスト（Feature Flow の 6 機能と一致）
  extras?: string[];      // プレミアム追加要素（あれば下にもう一段表示）
  note: string;           // カード内補足（features の下、CTA の上）
  ctaLabel: string;
  ctaHref: string;
  highlight?: boolean;
  badge?: string;
};

function PricingCard({
  name,
  price,
  description,
  features,
  extras,
  note,
  ctaLabel,
  ctaHref,
  highlight,
  badge,
}: PricingCardProps) {
  // 既存 padding（p-6 sm:p-7）が Card primitive の md/lg のどちらとも
  // 完全一致しないため、padding="none" + className で揃える。
  return (
    <Card
      variant={highlight ? 'highlight' : 'default'}
      padding="none"
      className="relative flex flex-col p-6 sm:p-7"
    >
      {badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center bg-accent-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
          {badge}
        </span>
      )}

      <p className="text-sm font-semibold text-slate-700 mb-1">{name}</p>
      <p className="text-xs sm:text-sm text-slate-500 leading-relaxed mb-5">
        {description}
      </p>

      <p className="flex items-end gap-1 mb-6">
        <span className="text-xs text-slate-500 mb-1">月額</span>
        <span
          className={`text-3xl sm:text-4xl font-extrabold leading-none ${
            highlight ? 'text-accent-600' : 'text-brand-600'
          }`}
        >
          {price}
        </span>
        <span className="text-sm text-slate-600 mb-1">円</span>
      </p>

      {/* 含まれる機能（Feature Flow の 6 機能と完全一致させて視覚的な紐付けを作る） */}
      <p className="text-xs font-bold text-slate-500 tracking-wide mb-3">
        含まれる機能
      </p>
      <ul className="space-y-2 mb-5">
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed"
          >
            <PricingCheck highlight={highlight} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* プレミアム追加要素（extras がある場合のみ） */}
      {extras && extras.length > 0 && (
        <>
          <p className="text-xs font-bold text-accent-600 tracking-wide mb-3">
            プレミアム追加要素
          </p>
          <ul className="space-y-2 mb-5">
            {extras.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed"
              >
                <PricingPlus />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 補足ノート（features の役割を 1 行で要約） */}
      <div className="border-t border-slate-100 pt-4 mb-5">
        <p
          className={`text-xs sm:text-sm leading-relaxed ${
            highlight ? 'text-accent-700 font-medium' : 'text-slate-600'
          }`}
        >
          {note}
        </p>
      </div>

      {/* PricingCard CTA: text-sm sm:text-base + font-bold + shadow-sm の独自サイズで
          LinkButton の lg / cta どちらとも完全一致しないため、ここは Link のまま残す。
          色はトークン（brand / accent）化済み。 */}
      <Link
        href={ctaHref}
        className={`mt-auto inline-flex justify-center items-center font-bold text-sm sm:text-base px-6 py-3 rounded-xl shadow-sm transition-colors ${
          highlight
            ? 'bg-accent-600 hover:bg-accent-700 text-white'
            : 'bg-brand-600 hover:bg-brand-700 text-white'
        }`}
      >
        {ctaLabel}
      </Link>
    </Card>
  );
}

function PricingCheck({ highlight }: { highlight?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`w-4 h-4 mt-0.5 shrink-0 ${
        highlight ? 'text-accent-500' : 'text-brand-500'
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

// プレミアム追加要素用：「+」アイコンで「追加でつく」感を出す
function PricingPlus() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="w-4 h-4 mt-0.5 shrink-0 text-accent-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}
