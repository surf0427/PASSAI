// /api/analysis/additional の deterministic skip 用 question pool。
//
// 役割:
//   activityData / existingQuestions / basicInfo / universityContext から安定 hash を作り、
//   pool から重複しない +2 問を deterministic に選んで返す。同一入力では常に同じ 2 問が
//   返るため、cache miss でも AI を呼ばずに「次の質問」を返せる。
//
// 設計:
//   - pool は「深掘り角度」12 問。category prefix は 5 軸（動機 / 課題 / 行動 / 成果 / 将来）
//     と同じで、initialQuestionsCatalog の KIND_TEMPLATES とは敢えて切り口を変える
//     （重複しても compare layer で弾く前提）。
//   - hash 入力には existingQuestions も含める。同 hash を引き継ぐ限り、画面を再読み込みしても
//     同じペアが返る。
//   - existingQuestions と category prefix を除いた本文先頭 24 字で正規化比較して重複を弾く。
//   - 重複除外後の候補が 2 未満なら null を返し、route 側を AI fallback 経路に倒す。
//
// 観測:
//   route 側で hash 値とともに「skip 発火」を console.info に出す。AI 呼び出しは
//   発生しないため aiUsageLog には乗らない（AI を消費していないことの観測 KPI）。

import type { ActivityData } from '@/types/activity';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { djb2 } from '@/lib/hash/djb2';
import { stableStringify } from '@/lib/hash/stableStringify';

// 深掘り角度の +12 問 pool。initialQuestionsCatalog の KIND_TEMPLATES と本文が
// 直接被らないように「具体場面の想起」「ふり返り」「外部からの視線」を多めに含める。
// 既存質問との衝突は normalizeForCompare で更に弾く前提。
const ADDITIONAL_POOL: string[] = [
  '【動機】その取り組みを最初の半年で続けられた理由を、当時の気持ちで思い出してください。',
  '【動機】今ふり返って「やめなかった本当の理由」は何だったと思いますか。',
  '【課題】周囲が思うように動いてくれなかった時、自分の中でどう折り合いをつけましたか。',
  '【課題】結果が出ない時期に「自分のせい」と感じた瞬間と、その時の判断を教えてください。',
  '【行動】最も小さく、しかし効いた工夫を 1 つ具体的に教えてください。',
  '【行動】自分一人では難しかった場面で、誰の力をどう借りましたか。',
  '【成果】数字に現れない変化のうち、自分が一番大切に思うものは何ですか。',
  '【成果】周囲からのフィードバックで一番印象に残ったコメントと、その理由を教えてください。',
  '【将来】志望学部のカリキュラムで、特に学びたい授業や研究領域は何ですか。',
  '【将来】卒業後 5 年後の自分が、この経験を後輩にどう語っていそうですか。',
  '【動機】当時の自分が「もう一度同じ選択をしますか」と聞かれたら、何と答えますか。',
  '【行動】判断に迷った場面で、最終的に拠り所にした基準は何でしたか。',
];

export type PickAdditionalQuestionsInput = {
  activityData: ActivityData;
  existingQuestions: string[];
  basicInfo: BasicInfo | null;
  universityContext: UniversityContext | null;
};

// 既存質問との重複判定。【カテゴリ】 prefix を剥がした本文の前 24 字で正規化比較する。
// AI 出力 / catalog 出力が同テーマでも文末の敬体差で別文字列になるケースを吸収する。
function normalizeForCompare(q: string): string {
  const stripped = q.replace(/^【[^】]*】\s*/, '').trim();
  return stripped.slice(0, 24);
}

function buildSeedHash(input: PickAdditionalQuestionsInput): string {
  return djb2(
    stableStringify({
      activityData: input.activityData,
      existingQuestions: input.existingQuestions,
      basicInfo: input.basicInfo,
      universityContext: input.universityContext,
    }),
  );
}

// 同一前提なら同一 2 問を返す deterministic な選択。
// existingQuestions と「先頭 24 字一致」する候補は除外。残り 2 問未満なら null（AI fallback へ）。
export function pickAdditionalQuestions(
  input: PickAdditionalQuestionsInput,
): { questions: string[]; hash: string } | null {
  const hash = buildSeedHash(input);

  const existingNormalized = new Set(input.existingQuestions.map(normalizeForCompare));
  const candidates = ADDITIONAL_POOL.filter(
    (q) => !existingNormalized.has(normalizeForCompare(q)),
  );

  if (candidates.length < 2) return null;

  // hash を seed にして 2 問を deterministic に選ぶ。
  // base36 文字列 → 数値復元 → mod で開始 index、step も hash 派生にして同 seed なら同 pair。
  const seedNum = parseInt(hash, 36) >>> 0;
  const startIdx = seedNum % candidates.length;
  const step = ((seedNum >>> 8) % (candidates.length - 1)) + 1;
  const secondIdx = (startIdx + step) % candidates.length;

  return {
    questions: [candidates[startIdx], candidates[secondIdx]],
    hash,
  };
}
