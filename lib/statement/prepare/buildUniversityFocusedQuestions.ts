// 大学軸の深掘り質問ビルダー（① 書く前に整理する機能・新フロー）。
//
// 役割:
//   - ユーザー入力（university / faculty / department）から大学DB context を
//     `lib/universities.ts` 境界経由で取り出す
//   - 「書類」selection_type の admission_policy / evaluation_points /
//     ai_strategy_hint を集約し、6 つの固定 question id にテンプレ embed する
//   - DB context が無い大学では generic fallback の問い文を返す
//   - AI は呼ばない（deterministic）。STEP1 は AI 精度作り込みより構造優先。
//
// 6 問の固定 id:
//   - why_this_uni    なぜこの大学なのか
//   - philosophy_fit  理念・アドミッションポリシーと自分の経験の接点
//   - learning_focus  この学部で何を学びたいか
//   - future_link     将来像との接続
//   - why_only_here   この大学でなければいけない理由
//   - activity_link   活動実績をどう評価軸へ接続するか
//
// 触らない:
//   - data/ 配下を直接 import しない（universities.ts 経由のみ）
//   - AI prompt / PROMPT_VERSION / `/api/statement-prepare` route
//
// ── 将来 AI 生成への拡張ポイント（実装は触らない・契約だけ揃える） ───────────
// 最終形は「友人が拡張中の大学DB」を使い、大学・学部・学科別の評価軸 / 過去問傾向 /
// アドミッションポリシー / ai_strategy_hint を AI に渡して、質問・整理メモを生成する。
//
//   現在:
//     buildUniversityFocusedQuestions(input) -> UniversityFocusedQuestion[]
//       実装: DB から書類 step の admission_policy / evaluation_points /
//             ai_strategy_hint を抽出 → テンプレに embed
//       戻り: 6 問の question + 各問に sourceContext（embed したスニペット）
//
//   将来:
//     generateUniversityFocusedQuestions(input, evaluationContext) -> Promise<UniversityFocusedQuestion[]>
//       実装: 同 DB context + 過去問傾向 + 学部・学科別評価軸を prompt 化 → AI 呼び出し
//       戻り: 同じ shape（id / label / hint / sourceContext）
//
//   schema を変えずに実装だけ差し替えられるよう、本ファイルは
//   loadUniversityEvaluationContext を export している（page から DB スナップショットを
//   取得して entry.evaluationContext に保存できる）。
//
//   TODO(AI 化 STEP): 過去問傾向の収集。
//     現在は selection_type === '書類' のみ集約しているが、過去問傾向は
//     '小論文' / '面接' selection_type の format / evaluation_points / ai_strategy_hint
//     に多く含まれる。AI 化 STEP で loadUniversityEvaluationContext を拡張し、
//     pastExamHints に '小論文' / '面接' step の format + ai_strategy_hint を入れる想定。
//
//   TODO(DB 拡張対応): 学部・学科別評価軸の専用フィールド。
//     友人が DB に「学部別」「学科別」の評価軸を追加した時点で、ここで集約して
//     evaluationContext.facultyAxes / departmentAxes 等の新フィールドに載せる。

import {
  findUniversityEntriesByUserChoices,
  getSelectionStepsByEntryId,
} from '@/lib/universities';
import type {
  QuestionSourceContext,
  UniversityEvaluationContext,
  UniversityFocusedQuestionId,
} from '@/lib/statement/prepare/universityPrepareHistory';

export type UniversityFocusedQuestion = {
  id: UniversityFocusedQuestionId;
  label: string;
  // 補足ヒント文（UI 上で label の下に薄く表示する想定。空文字なら表示しない）
  hint: string;
  // 質問文を作る根拠となった DB スニペット。未使用時は undefined。
  // 将来 AI 生成に切り替えた時、AI に同 shape で「どのスニペットから生成したか」を
  // 戻させれば storage / UI を変えずに済む。
  sourceContext?: QuestionSourceContext;
};

// "あり" のみ意味あり。"なし" / "不明" / 空欄 は false。
function isMeaningfulValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed === '不明') return false;
  if (trimmed === 'なし') return false;
  return true;
}

function uniqueMeaningful(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    if (!isMeaningfulValue(v)) continue;
    const trimmed = v.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

// admission_policy / evaluation_points / ai_strategy_hint は CSV 由来で長文・
// 文末記号混在のケースがある。質問文に自然に embed するため、一定字数で切って
// 「…」を付ける。複数候補があっても最も先頭の 1 つだけ使う（質問が長文化する
// のを避ける）。
function pickShortRepresentative(
  values: string[],
  maxChars: number,
): string | null {
  const trimmed = uniqueMeaningful(values);
  if (trimmed.length === 0) return null;
  const head = trimmed[0];
  if (head.length <= maxChars) return head;
  return head.slice(0, maxChars).trimEnd() + '…';
}

// 大学・学部・学科の DB スナップショット。AI 生成 STEP では entry.evaluationContext に
// そのまま保存し、prompt 入力としても利用する想定（lib/universities.ts 境界経由のみ）。
//
// 現在は selection_type === '書類' のみ集約。将来 pastExamHints は別 selection_type
// （'小論文' / '面接'）から収集して付与する。
export function loadUniversityEvaluationContext(input: {
  university: string;
  faculty?: string;
  department?: string;
}): UniversityEvaluationContext {
  const entries = findUniversityEntriesByUserChoices(input);
  if (entries.length === 0) {
    return { admissionPolicies: [], evaluationPoints: [], aiStrategyHints: [] };
  }
  const documentSteps = entries.flatMap((e) =>
    getSelectionStepsByEntryId(e.entry_id).filter(
      (s) => s.selection_type === '書類',
    ),
  );
  return {
    admissionPolicies: uniqueMeaningful(documentSteps.map((s) => s.admission_policy)),
    evaluationPoints: uniqueMeaningful(documentSteps.map((s) => s.evaluation_points)),
    aiStrategyHints: uniqueMeaningful(documentSteps.map((s) => s.ai_strategy_hint)),
    // pastExamHints は将来 AI 化 STEP で populate（現状は未収集）。
  };
}

export function buildUniversityFocusedQuestions(input: {
  university: string;
  faculty?: string;
  department?: string;
}): UniversityFocusedQuestion[] {
  const uniName = input.university.trim();
  const facultyName = (input.faculty ?? '').trim();
  const ctx = loadUniversityEvaluationContext(input);

  const policySnippet = pickShortRepresentative(ctx.admissionPolicies, 80);
  const evalSnippet = pickShortRepresentative(ctx.evaluationPoints, 60);
  const hintSnippet = pickShortRepresentative(ctx.aiStrategyHints, 70);

  // 大学・学部の呼び方を質問文用に整える。空でも generic に逃げられるようにする。
  const uniLabel = uniName || 'この大学';
  const facultyLabel = facultyName ? `${facultyName}` : 'この学部';

  // sourceContext factory: スニペットを使った質問だけに紐付ける（undefined を返せば
  // storage 側で省略される）。AI 化後は同じ shape を AI に返させればよい。
  const ctxFromPolicy = (snippet: string | null): QuestionSourceContext | undefined =>
    snippet ? { admissionPolicySnippet: snippet } : undefined;
  const ctxFromEval = (snippet: string | null): QuestionSourceContext | undefined =>
    snippet ? { evaluationPointSnippet: snippet } : undefined;
  const ctxFromHint = (snippet: string | null): QuestionSourceContext | undefined =>
    snippet ? { aiStrategyHintSnippet: snippet } : undefined;

  return [
    {
      id: 'why_this_uni',
      label: `なぜ${uniLabel}を志望していますか？`,
      hint:
        '他大学ではなく「ここを選ぶ」と決めた理由を、自分の言葉で短く整理してみましょう。',
    },
    {
      id: 'philosophy_fit',
      label: policySnippet
        ? `${uniLabel}が重視している「${policySnippet}」と、あなたの経験のどこに接点がありますか？`
        : `${uniLabel}の理念・アドミッションポリシーと、あなたの経験で接点になりそうな部分はどこですか？`,
      hint: policySnippet
        ? 'DBから取り出した観点です。自分の経験のどの部分が当てはまりそうか考えてみましょう。'
        : '理念は大学公式サイトで確認してから書くと、より具体的に答えられます。',
      sourceContext: ctxFromPolicy(policySnippet),
    },
    {
      id: 'learning_focus',
      label: `${facultyLabel}で具体的に何を学びたいですか？`,
      hint:
        '「理論／データ／現場」のどの方向で深めたいかを一言メモするだけでも、後段の文章化が進めやすくなります。',
    },
    {
      id: 'future_link',
      label: `${facultyLabel}での学びは、あなたの将来像とどのようにつながりますか？`,
      hint:
        '職業名で決めきらなくて構いません。「誰の・何の役に立ちたいか」レベルで OK です。',
    },
    {
      id: 'why_only_here',
      label: hintSnippet
        ? `${uniLabel}でなければいけない理由は何ですか？（参考: ${hintSnippet}）`
        : `${uniLabel}でなければいけない理由は何ですか？`,
      hint:
        '他大学では代替できない要素（カリキュラム・教員・立地・接続先など）を一つ挙げてみましょう。',
      sourceContext: ctxFromHint(hintSnippet),
    },
    {
      id: 'activity_link',
      label: evalSnippet
        ? `${uniLabel}が見ている観点「${evalSnippet}」に、あなたの活動実績はどう接続しますか？`
        : `あなたの活動実績は、大学側が重視しそうな評価観点にどう接続しますか？`,
      hint: evalSnippet
        ? 'DBから取り出した観点です。あなたの活動のどの部分を見せれば伝わるかメモしましょう。'
        : '評価観点は大学公式サイトの「アドミッションポリシー」「求める学生像」を確認すると見つけやすいです。',
      sourceContext: ctxFromEval(evalSnippet),
    },
  ];
}
