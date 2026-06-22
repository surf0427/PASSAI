// 番号付きカードで「合格までの流れ」を提示。
// スマホ：1列／タブレット：2列／PC：3列のグリッド。
// 番号バッジ自体が「流れ」の可読性を担保するため、矢印類は省略。
//
// カード構成は「アイコン → 機能名 → 1〜2行の説明 → 特徴(最大5) → キャッチコピー」で統一。
// flex-col + 説明 flex-1 の構造で、グリッド内の同じ行のカードどうしで
// 「特徴・キャッチコピーの位置」が揃う。
//
// 流れのステップとは別に、それらを横断して支える機能（受験相談AI / マイページ）を
// 「流れ全体を支える機能」として番号なしの別ブロックで提示する。
// num を省略すると番号バッジが消える以外は、流れカードと同一デザインを共有する。
//
// AI面接・プレゼン練習は PASSAI の差別化機能のため、isNew で控えめな NEW バッジを付与する。

type StepCardProps = {
  num?: string;
  icon: string;
  title: string;
  desc: string;
  tags: string[];
  catchphrase: string;
  isNew?: boolean;
};

function StepCard({ num, icon, title, desc, tags, catchphrase, isNew }: StepCardProps) {
  return (
    <li className="list-none flex flex-col bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 sm:p-7">
      <div className="flex items-center gap-2.5 mb-3">
        {num && (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-brand-50 text-brand-700 text-sm font-extrabold tracking-tight shrink-0">
            {num}
          </span>
        )}
        <span className="text-2xl leading-none shrink-0" aria-hidden="true">
          {icon}
        </span>
        <p className="text-base sm:text-lg font-bold text-slate-900">{title}</p>
        {isNew && (
          <span className="ml-auto inline-flex items-center rounded-full bg-accent-600 text-white px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0">
            NEW
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 leading-relaxed mb-4 flex-1">{desc}</p>
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
      <p className="mt-4 pt-4 border-t border-slate-100 text-sm font-semibold text-brand-700">
        {catchphrase}
      </p>
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
            活動整理から自己分析、志望理由書、小論文、AI面接・プレゼン練習まで。
            <br className="hidden sm:inline" />
            バラバラに対策するのではなく、入力した内容を次の対策に活かしながら進められます。
            <br className="hidden sm:inline" />
            さらに、受験相談AIとマイページが相談と振り返りで全体を支えます。
          </p>
        </div>

        <ol className="grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <StepCard
            num="01"
            icon="🗂️"
            title="活動整理"
            desc="部活・留学・ボランティアなどの経験を、質問に答えるだけで整理。面接や志望理由書で使える形にまとまります。"
            tags={['#経験整理', '#AIヒント', '#面接につながる']}
            catchphrase="「経験を、武器に変える。」"
          />
          <StepCard
            num="02"
            icon="🔍"
            title="自己分析"
            desc="「なぜその行動をしたのか」をAIが深掘り。自分でも気づかなかった強みを言葉にできます。"
            tags={['#AI深掘り', '#強み分析', '#面接対策']}
            catchphrase="「自分の強みを、言葉にする。」"
          />
          <StepCard
            num="03"
            icon="🎯"
            title="志望校マッチング"
            desc="活動内容・自己分析・志望理由から、大学ごとの相性をAIが分析。足りない点や改善点まで確認できます。"
            tags={['#大学分析', '#改善ポイント', '#相性診断']}
            catchphrase="「最適な一校を、データで探す。」"
          />
          <StepCard
            num="04"
            icon="✍️"
            title="志望理由書"
            desc="AIとの質問形式で志望動機を整理し、大学との一致・具体性・説得力を見ながら添削します。"
            tags={['#AI添削', '#大学一致', '#具体性UP']}
            catchphrase="「想いを、伝わる文章に。」"
          />
          <StepCard
            num="05"
            icon="📄"
            title="小論文"
            desc="大学ごとのテーマ傾向から、考え方・構成・書き方を整理。弱い主張や足りない視点をAIが指摘します。"
            tags={['#構成サポート', '#大学別対策', '#視点整理']}
            catchphrase="「考える力を、組み立てる。」"
          />
          <StepCard
            num="06"
            icon="🤖"
            title="AI面接"
            desc="本番さながらのAI面接官と実践練習。音声で回答し、その場でフィードバックを受けながら改善できます。"
            tags={['#音声回答', '#AIフィードバック', '#成長記録', '#本番モード', '#圧迫面接モード']}
            catchphrase="「面接経験を、AIで積み重ねる。」"
            isNew
          />
          <StepCard
            num="07"
            icon="🎥"
            title="プレゼン練習"
            desc="録画したプレゼンをAIが分析。話し方・構成・説得力を評価し、発表後の質疑応答まで練習できます。"
            tags={['#プレゼン録画', '#資料表示', '#AI採点', '#発表後Q&A', '#成長レポート']}
            catchphrase="「話す力を、可視化して伸ばす。」"
            isNew
          />
        </ol>

        {/* 流れ全体を支える機能：順序フローには属さない横断機能。
            番号バッジを外し、見出しで「下支え」だと一目で分かるようにする。 */}
        <div className="mt-12 sm:mt-16">
          <div className="text-center mb-6 sm:mb-8">
            <h3 className="text-lg sm:text-2xl font-extrabold tracking-tight leading-snug mb-2">
              流れ全体を支える機能
            </h3>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              どのステップの途中でも、いつでも相談でき、これまでの取り組みを振り返れます。
            </p>
          </div>

          <ul className="grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <StepCard
              icon="💬"
              title="受験相談AI"
              desc="志望校選びから面接の不安まで、受験の悩みを24時間いつでも相談。これまでの自己分析や活動整理をふまえて答えます。"
              tags={['#24時間相談', '#あなた専用', '#具体的アドバイス']}
              catchphrase="「いつでも、あなた専用の相談相手。」"
            />
            <StepCard
              icon="📊"
              title="マイページ"
              desc="自己分析・志望理由書・小論文・面接などの履歴や成長記録を、ひとつの場所でまとめて管理できます。"
              tags={['#一元管理', '#成長記録', '#振り返り']}
              catchphrase="「努力の軌跡を、見える化する。」"
            />
          </ul>
        </div>
      </div>
    </section>
  );
}
