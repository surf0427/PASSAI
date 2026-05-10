// 6 ステップを番号付きカードで提示。
// スマホ：1列／タブレット：2列／PC：3列のグリッド。
// 番号バッジ自体が「流れ」の可読性を担保するため、矢印類は省略。
//
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

export function FeatureFlowSection() {
  return (
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
  );
}
