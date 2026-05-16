import type {
  InterviewTalkingPoint,
  InterviewTalkingPointCategory,
} from '@/lib/buildInterviewTalkingPoints';

type Props = {
  points: InterviewTalkingPoint[];
};

// カテゴリ別の見出しバッジ色。/self-analysis の AnalysisResultCard と同系の
// 強み=blue / 経験=green / 将来=purple / 補強=orange パレットに揃える。
const CATEGORY_STYLES: Record<InterviewTalkingPointCategory, string> = {
  '強み':              'bg-blue-50 border-blue-200 text-blue-800',
  '代表的な経験':      'bg-green-50 border-green-200 text-green-800',
  '将来像':            'bg-purple-50 border-purple-200 text-purple-800',
  '弱みへの向き合い方': 'bg-orange-50 border-orange-200 text-orange-800',
};

// 自己分析の整理メモから派生した「面接で答えるときの足場」を一覧表示する。
// points 配列が空のときは何も描画しない（StudentProfile 未生成の場合の自然 fallback）。
export function InterviewTalkingPointsCard({ points }: Props) {
  if (points.length === 0) return null;

  return (
    <section className="mb-8 bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-base font-bold text-gray-800 mb-2">面接で話せる要点</h2>
      <p className="text-sm text-gray-500 mb-5 leading-relaxed">
        自己分析の整理メモから抽出した「面接で答えるときの足場」です。
        練習や本番の前に、自分の言葉で言い直せるか確認してください。
      </p>
      <ul className="space-y-4">
        {/* PR8c: key を category + headline の複合に。points は StudentProfile から
            毎 render 同じ source で derive されるため index でも実害は薄いが、
            PR8c「key={i} を増やさない」方針に合わせて stable key に揃える。 */}
        {points.map((p) => (
          <li
            key={`${p.category}-${p.headline}`}
            className="border border-gray-100 rounded-lg p-4"
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${CATEGORY_STYLES[p.category]}`}
              >
                {p.category}
              </span>
              <span className="text-xs text-gray-500">{p.headline}</span>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed">{p.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
