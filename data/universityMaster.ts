// 大学マスタ (学校単位の共通情報)
//
// - data/universityEntries.ts (入試方式単位) と併存。結合キーは school_id。
// - 重複大学情報を整理し、将来の feature-specific context enrich の土台とする。
// - 値は universityEntries から抽出した school_id / university_name のみ実値。
//   その他のカラムは空欄のまま。AI 推測で埋めない（不明値は空欄を維持する）。
// - 現時点ではどこからも import しない。消費者が現れた段階で
//   lib/universities.ts に最小 helper を追加する。
// - 詳細ルールは docs/principles/university_database_usage_guide.md 参照。

export type UniversityMaster = {
  school_id: string;
  university_name: string;
  university_name_kana: string;
  prefecture: string;
  category: string;       // 国立 / 公立 / 私立
  field: string;          // 文系 / 理系 / 総合（多くの総合大学は空欄が妥当）
  official_url: string;
  data_year: string;
  notes: string;
};

export const universityMasters: UniversityMaster[] = [
  { school_id: "U001", university_name: "学習院大学",     university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U002", university_name: "明治大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U003", university_name: "青山学院大学",   university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U004", university_name: "立教大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U005", university_name: "中央大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U006", university_name: "法政大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U007", university_name: "関西大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U008", university_name: "関西学院大学",   university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U009", university_name: "同志社大学",     university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U010", university_name: "立命館大学",     university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U011", university_name: "成蹊大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U012", university_name: "成城大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U013", university_name: "明治学院大学",   university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U014", university_name: "獨協大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U015", university_name: "國學院大學",     university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U016", university_name: "武蔵大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U017", university_name: "京都産業大学",   university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U018", university_name: "近畿大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U019", university_name: "甲南大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U020", university_name: "龍谷大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U021", university_name: "日本大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U022", university_name: "東洋大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U023", university_name: "駒澤大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
  { school_id: "U024", university_name: "専修大学",       university_name_kana: "", prefecture: "", category: "", field: "", official_url: "", data_year: "", notes: "" },
];
