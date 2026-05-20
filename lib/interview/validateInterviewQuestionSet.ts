// 面接質問生成の出力構造監査（post-check guard）。
//
// 役割:
//   /api/interview-questions が AI から受け取った TwoLayerInterviewQuestions に対して、
//   prompt v5 で明文化した「固定重要枠 / 偏り禁止 / 最重要エピソード必須残留」のうち
//   **明らかな崩れだけ** を deterministic に検出する。AI に再判定させない。
//
// 設計方針（lightweight guard）:
//   - 大規模 validator にしない: rule-based / 単純 keyword 照合のみ
//   - retry の判断材料を返すだけで、retry の発火は route 側の責務
//   - NLP / 形態素解析 / 外部依存ゼロ
//   - 失敗時は理由配列を返し、route 側で console.warn する想定（本ファイルは log を出さない）
//   - 出力 schema は壊さず、判定だけを担当する
//
// 検出する崩れ:
//   A. 単一活動偏重: personalized 5 問のうち、同一活動 topic が 4 問以上含まれていたら fail
//   B. 最重要エピソード消失: 素材で繰り返し言及される活動 topic が personalized に 0 件なら fail
//   C. 必須 category 欠落: personalized から 'authenticity_check' / 'university_fit' /
//      'future_goal' のいずれかが欠けていたら fail
//
// 検出しない崩れ（明らかな崩れに該当しないため意図的にスコープ外）:
//   - 質問文の品質・自然さ
//   - 大学情報の事実誤り
//   - answerTip の代筆判定
//   - 件数（5+5）— parseInterviewQuestions が既に slice + 空チェック
//
// 関連:
//   - types/interviewQuestions.ts
//   - lib/interview/buildInterviewQuestionMaterials.ts
//   - lib/interview/buildInterviewQuestionPrompt.ts（v5 prompt と整合）
//   - app/api/interview-questions/route.ts（consumer）

import type { InterviewQuestionMaterials } from './buildInterviewQuestionMaterials';
import type {
  PersonalizedInterviewQuestion,
  TwoLayerInterviewQuestions,
} from '@/types/interviewQuestions';

// ── topic 辞書 ─────────────────────────────────────────────────────
//
// 活動 topic の粗い分類。形態素解析を入れず、substring 検出のみで判定するため、
// パターンは「明確な活動名」だけに絞る（短すぎる語・部分一致しやすい語は入れない）。
// 「明らかな偏り」の検出が目的であり、網羅性は意図的に追わない。
// false negative（捕捉漏れ）は許容、false positive（誤検出による retry 多発）を避ける。
const ACTIVITY_TOPIC_PATTERNS = {
  study_abroad: ['留学', '海外研修', 'ホームステイ', '語学研修', '海外滞在'],
  sports: [
    'サッカー',
    '野球',
    'バスケ',
    'バレー',
    '陸上',
    '剣道',
    '柔道',
    '水泳',
    'テニス',
    'ラグビー',
    '弓道',
    '卓球',
    'ハンドボール',
    'ダンス',
  ],
  arts_culture_club: [
    '吹奏楽',
    '合唱',
    '演劇',
    '軽音',
    '美術部',
    '書道部',
    '茶道',
    '華道',
    '写真部',
    '科学部',
  ],
  volunteer: ['ボランティア', '地域活動', '社会奉仕', 'チャリティ'],
  inquiry_research: ['探究', '探求', '課題研究', '研究活動'],
  student_council: ['生徒会', '実行委員', '文化祭運営', '体育祭運営'],
  qualification: ['英検', 'TOEIC', 'TOEFL', '資格取得', '検定'],
  part_time: ['アルバイト', 'バイト'],
  competition: ['コンテスト', 'コンクール', '大会出場', '甲子園'],
  generic_club: ['部活', '部活動', 'クラブ活動'],
} as const;

type ActivityTopicId = keyof typeof ACTIVITY_TOPIC_PATTERNS;

// 単一 topic が personalized 5 問のうち何問まで占めてよいか。
// 4 問以上で fail（=「今日は留学だけ」のような偏り）。
const SINGLE_ACTIVITY_LIMIT = 3;

// 素材内で何回以上言及されたら「最重要候補」とみなすか。
// 3 回未満は単発言及とみなして key episode 判定の対象外（false positive 抑制）。
const KEY_EPISODE_THRESHOLD = 3;

// system prompt v5 / 本 STEP で「明らかな崩れ」として弾く必須 category。
// 5 種すべて（authenticity_check / consistency_check / university_fit / future_goal /
// self_analysis）は system prompt 側で要求されているが、validator は **「明らかな
// 崩れだけ」** に絞るため、合否直結性が特に高い 3 種に限定する。残り 2 種の欠落は
// prompt の self-policing に委ねる。
const REQUIRED_PERSONALIZED_CATEGORIES = [
  'authenticity_check',
  'university_fit',
  'future_goal',
] as const;

// fail 理由の文字列タグ。形式は `RULE_ID:detail`。
// route 側 console.warn / aiUsageLog 経由の集計を想定。
export type ValidationFailureReason = string;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reasons: ValidationFailureReason[] };

// 公開 API: 同期的・純粋関数。同じ入力に対して常に同じ判定を返す。
export function validateInterviewQuestionSet(
  questions: TwoLayerInterviewQuestions,
  materials: InterviewQuestionMaterials,
): ValidationResult {
  const reasons: ValidationFailureReason[] = [];

  // A. 単一活動偏重チェック
  const overload = checkSingleActivityOverload(questions.personalized);
  if (!overload.ok) {
    reasons.push(`SINGLE_ACTIVITY_OVERLOAD:${overload.topic}:${overload.count}/5`);
  }

  // B. 最重要エピソード消失チェック（素材から候補が特定できた場合のみ実施）
  const keyTopic = inferKeyEpisodeTopic(materials);
  if (keyTopic && !isTopicMentionedInPersonalized(keyTopic, questions.personalized)) {
    reasons.push(`KEY_EPISODE_MISSING:${keyTopic}`);
  }

  // C. 必須 category 欠落チェック
  const missing = findMissingRequiredCategories(questions.personalized);
  for (const cat of missing) {
    reasons.push(`REQUIRED_CATEGORY_MISSING:${cat}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// ── 内部 helper ───────────────────────────────────────────────────

// A. 単一活動偏重チェック。
// 各 personalized 質問に対して、含まれる activity topic を「重複なし」で集計する
// （同じ質問が 2 つのキーワードを含んでも 1 票止まり）。
// 上限を超える topic があれば最大カウントの topic を返す。
function checkSingleActivityOverload(
  personalized: readonly PersonalizedInterviewQuestion[],
): { ok: true } | { ok: false; topic: ActivityTopicId; count: number } {
  const counts = new Map<ActivityTopicId, number>();
  for (const q of personalized) {
    const text = `${q.question} ${q.intent ?? ''}`;
    const matched = new Set<ActivityTopicId>();
    for (const id of Object.keys(ACTIVITY_TOPIC_PATTERNS) as ActivityTopicId[]) {
      for (const p of ACTIVITY_TOPIC_PATTERNS[id]) {
        if (text.includes(p)) {
          matched.add(id);
          break;
        }
      }
    }
    for (const id of matched) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  let topId: ActivityTopicId | null = null;
  let topCount = 0;
  for (const [id, c] of counts) {
    if (c > topCount) {
      topId = id;
      topCount = c;
    }
  }
  if (topId !== null && topCount > SINGLE_ACTIVITY_LIMIT) {
    return { ok: false, topic: topId, count: topCount };
  }
  return { ok: true };
}

// B. 素材から最重要エピソード topic を推定する。
// 志望理由書サマリー / 活動サマリー / studentProfile 由来 list を 1 本に連結し、
// 各 topic のパターン出現回数を数える。最大カウントが KEY_EPISODE_THRESHOLD
// 未満なら「最重要候補なし」として null を返す（false positive 抑制）。
function inferKeyEpisodeTopic(
  materials: InterviewQuestionMaterials,
): ActivityTopicId | null {
  const source = [
    materials.statementSummary ?? '',
    materials.activitySummary ?? '',
    materials.strengths.join(' '),
    materials.interests.join(' '),
    materials.futureGoals.join(' '),
  ].join(' ');
  if (source.trim() === '') return null;

  let topId: ActivityTopicId | null = null;
  let topCount = 0;
  for (const id of Object.keys(ACTIVITY_TOPIC_PATTERNS) as ActivityTopicId[]) {
    let c = 0;
    for (const p of ACTIVITY_TOPIC_PATTERNS[id]) {
      c += countSubstring(source, p);
    }
    if (c > topCount) {
      topCount = c;
      topId = id;
    }
  }
  if (topCount < KEY_EPISODE_THRESHOLD) return null;
  return topId;
}

function isTopicMentionedInPersonalized(
  topic: ActivityTopicId,
  personalized: readonly PersonalizedInterviewQuestion[],
): boolean {
  const patterns = ACTIVITY_TOPIC_PATTERNS[topic];
  for (const q of personalized) {
    const text = `${q.question} ${q.intent ?? ''}`;
    for (const p of patterns) {
      if (text.includes(p)) return true;
    }
  }
  return false;
}

function findMissingRequiredCategories(
  personalized: readonly PersonalizedInterviewQuestion[],
): string[] {
  const present = new Set(personalized.map((q) => q.category));
  const missing: string[] = [];
  for (const cat of REQUIRED_PERSONALIZED_CATEGORIES) {
    if (!present.has(cat)) missing.push(cat);
  }
  return missing;
}

// 部分文字列の出現回数（overlap なし）。RegExp を避けて metachar の事故を防ぐ。
function countSubstring(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}
