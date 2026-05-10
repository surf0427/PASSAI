// PASSAI shared/result — StrengthWeaknessGrid
//
// AI 結果でよく出る「強み（青系・✓）/ 補強ポイント（オレンジ系・△）」の
// 2 カラム表示を共通化する。
//
// 現状の出現箇所:
//   - admission-matching の確認画面・結果画面（wallHitting summary）
//   - 自己分析・志望理由書フィードバックなどでも今後増える想定
//
// 設計方針:
//   - props は最小：strengths / weaknesses の配列＋ optional な maxItems と label 上書き。
//   - 強み = ブランドの安心色（brand-blue）、補強ポイント = 注意の温色（orange）。
//   - 「強み」「補強ポイント」のラベル文言は label プロパティで上書き可能（マッチング系では
//     「合っている点 / 課題」など別表現も想定されるため）。
//   - 件数フィルタは呼び出し側でやってもよいが、UI 統一のため maxItems で吸収できる。

type Props = {
  strengths: string[];
  weaknesses: string[];
  /** 強み列のラベル。既定: "強み"。例: "合っている点" など */
  strengthLabel?: string;
  /** 補強ポイント列のラベル。既定: "補強ポイント"。例: "課題" など */
  weaknessLabel?: string;
  /** 各列の最大表示件数。未指定なら全件表示。 */
  maxItems?: number;
};

export function StrengthWeaknessGrid({
  strengths,
  weaknesses,
  strengthLabel = '強み',
  weaknessLabel = '補強ポイント',
  maxItems,
}: Props) {
  const sList = maxItems !== undefined ? strengths.slice(0, maxItems) : strengths;
  const wList = maxItems !== undefined ? weaknesses.slice(0, maxItems) : weaknesses;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <p className="text-xs font-semibold text-brand-700 mb-1">{strengthLabel}</p>
        <ul className="space-y-0.5">
          {sList.map((s, i) => (
            // brand-800 は @theme 未定義のため Tailwind 既定 blue-800 を直接使う。
            // 将来 --color-brand-800 を追加した時に差し替える。
            <li key={i} className="text-xs text-blue-800">✓ {s}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold text-orange-700 mb-1">{weaknessLabel}</p>
        <ul className="space-y-0.5">
          {wList.map((w, i) => (
            <li key={i} className="text-xs text-orange-800">△ {w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
