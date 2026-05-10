import { Card } from '@/components/ui/Card';

// 他社比較。攻撃的にならないよう「方向性の違い」として見せる。
// スマホ：各行で「比較ポイント」を上に置き、その下で 一般塾 / PASSAI を
// 2 カラムで横並び（横スクロールなし）。
// PC：3 カラムの表（比較ポイント / 一般塾 / PASSAI）。
// PASSAI 列は bg-brand-50 + text-brand-700 + border-l-blue-100 で強調。
//
// PDF「競合塾比較表 v8」の 8 項目を反映。
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

export function CompareSection() {
  return (
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
  );
}
