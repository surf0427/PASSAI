// 01〜06 の番号付きカードで「合格までの流れ」を提示。
// スマホ：1列／タブレット：2列／PC：3列のグリッド。
// 番号バッジ自体が「流れ」の可読性を担保するため、矢印類は省略。
//
// 番号バッジ + タイトル + 多段落の説明文 + 下部にタグ pill。
// flex-col + 説明 flex-1 + タグ末尾固定の構造で、
// グリッド内の同じ行のカードどうしで「タグの位置」が揃う。
//
// 流れの 6 ステップとは別に、それらを横断して支える機能（受験相談AI / マイページ）を
// 「流れ全体を支える機能」として番号なしの別ブロックで提示する。
// num を省略すると番号バッジが消える以外は、流れカードと同一デザインを共有する。
//
// 説明文は \n\n で段落区切り。CSS の whitespace-pre-line が空行を再現する。
//
// デモ画像（スクリーンショット・任意）：
//   demoSrc を渡したカードだけ、説明文の下・タグの上にスクショ枠を表示する。
//   demoSrc 未設定のカードは従来どおり（枠ごと描画されない）。
//   ファイルは public/landing/features/ 配下に .webp / .png で置く想定
//   （例: demoSrc="/landing/features/self-analysis.webp"）。
//
//   表示方針（ScreenshotPreview 参照）：
//   縦長スクショを縮小しすぎないよう、枠は固定 max-height を持ち、枠内を縦スクロール。
//   画像は横幅100% × 自然な高さ（object-cover で切り抜かない）。
//   下部のフェード＋「スクロールして全体を見る」で、続きがあることを示す。
//   静止画なので next/image の最適化に任せる（unoptimized は付けない）。

import Image from 'next/image';

// 縦長スクショ用のプレビュー枠。
// 枠は固定 max-height を持ち、枠内を縦スクロールして全体を確認できる。
// 画像は width=0 / height=0 + className w-full h-auto で「横幅100% × 自然な高さ」に。
//   （next/image に必須の width/height をダミー指定しつつ、実寸比は読み込んだ画像から保つ定石）
// 下部のフェード＋ヒントで「続きがある」ことを示す（pointer-events-none で操作を邪魔しない）。
function ScreenshotPreview({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative mb-5 overflow-hidden rounded-xl ring-1 ring-slate-200 shadow-sm bg-slate-50">
      <div className="max-h-56 sm:max-h-64 overflow-y-auto overscroll-contain">
        <Image
          src={src}
          alt={alt}
          width={0}
          height={0}
          loading="lazy"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="block w-full h-auto"
        />
      </div>
      {/* スクロール可能を示す下部フェード＋ヒント（枠に固定。中身と一緒には動かない） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white via-white/70 to-transparent" />
      <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[10px] font-medium text-slate-500">
        スクロールして全体を見る ↓
      </span>
    </div>
  );
}

type StepCardProps = {
  num?: string;
  title: string;
  desc: string;
  tags: string[];
  // 任意：デモ画像（スクリーンショット）。未設定ならデモ枠は一切描画しない。
  demoSrc?: string;
  demoAlt?: string;
};

function StepCard({ num, title, desc, tags, demoSrc, demoAlt }: StepCardProps) {
  return (
    <li className="list-none flex flex-col bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm p-6 sm:p-7">
      <div className="flex items-center gap-3 mb-3">
        {num && (
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-brand-50 text-brand-700 text-sm font-extrabold tracking-tight">
            {num}
          </span>
        )}
        <p className="text-base sm:text-lg font-bold text-slate-900">{title}</p>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line mb-5 flex-1">
        {desc}
      </p>
      {demoSrc && (
        <ScreenshotPreview src={demoSrc} alt={demoAlt ?? `${title}の画面イメージ`} />
      )}
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
            <br className="hidden sm:inline" />
            さらに、受験相談AIとマイページが相談と振り返りで全体を支えます。
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

        {/* 流れ全体を支える機能：01〜06 の順序フローには属さない横断機能。
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
              title="受験相談AI"
              desc={
                '志望校選び、学習計画、面接の不安、志望理由書の方向性まで。受験の悩みを24時間いつでも相談できます。\n\n' +
                'これまでの自己分析や活動整理をふまえて、AIが一人ひとりに合わせた具体的なアドバイスを返します。'
              }
              tags={['#24時間相談', '#あなた専用', '#具体的アドバイス']}
            />
            <StepCard
              title="マイページ"
              desc={
                '自己分析・志望理由書・小論文・面接練習の履歴や成長記録を、ひとつの場所でまとめて管理。\n\n' +
                'これまでの取り組みを振り返りながら、効率的に受験準備を進められます。'
              }
              tags={['#一元管理', '#成長記録', '#振り返り']}
            />
          </ul>
        </div>
      </div>
    </section>
  );
}
