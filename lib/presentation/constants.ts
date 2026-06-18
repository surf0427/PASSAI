import 'server-only';

/**
 * STEP-PRESENTATION-PR5: プレゼン evaluate route の共有定数。
 *
 * route key の単一情報源:
 *   recordUsage の route key は **必ず PRESENTATION_USAGE_ROUTE='presentation'** に統一する。
 *   FEATURE_ROUTE_KEYS['presentation'] = ['presentation']（lib/billing/quotas.ts）と完全一致。
 */

// recordUsage 専用の route key。課金計上はこの 1 値のみを使う。
export const PRESENTATION_USAGE_ROUTE = 'presentation';

// logAiUsage（観測）専用の route 識別子。recordUsage の key とは別軸（quota には影響しない）。
export const PRESENTATION_EVALUATE_LOG_ROUTE = 'api/presentation/evaluate';

// AI 評価生成に使う model。MVP は面接AIと同じ sonnet に揃える（コスト優先）。
export const PRESENTATION_EVAL_MODEL = 'claude-sonnet-4-6';

// 評価 JSON（categories 6 軸 + 3 配列 + 総括）の出力上限。perQuestion 配列が無いぶん面接(4000)より小さく。
export const PRESENTATION_EVAL_MAX_TOKENS = 2000;

// 配列項目の個数規約（出力品質条件）。
export const PRESENTATION_LIST_MIN = 2;
export const PRESENTATION_LIST_MAX = 4;

// ── 発表後 Q&A（/api/presentation/qa）──────────────────────────────
// Q&A は無限に続けない。質問は最大 5 問まで（role='question' の件数で制御）。
export const PRESENTATION_QA_MAX_QUESTIONS = 5;
// 回答の入力サイズガード（暴走 payload 防止）。面接AI（8000）に揃える。
export const PRESENTATION_QA_MAX_ANSWER_CHARS = 8000;
// Q&A の質問 1 文 / 総評の出力上限。
export const PRESENTATION_QA_QUESTION_MAX_TOKENS = 400;
export const PRESENTATION_QA_FINISH_MAX_TOKENS = 1000;
// finish 総評の配列件数（1〜3 個）。
export const PRESENTATION_QA_FINISH_LIST_MIN = 1;
export const PRESENTATION_QA_FINISH_LIST_MAX = 3;
// logAiUsage（観測）用 route 識別子。recordUsage の key とは別軸（quota 非加算）。
export const PRESENTATION_QA_KICKOFF_LOG_ROUTE = 'api/presentation/qa:kickoff';
export const PRESENTATION_QA_FOLLOWUP_LOG_ROUTE = 'api/presentation/qa:followup';
export const PRESENTATION_QA_FINISH_LOG_ROUTE = 'api/presentation/qa:finish';
// stateless（DB保存なし）の単発 Q&A 練習用（result 画面の発表後 Q&A）。
export const PRESENTATION_QA_GENERATE_LOG_ROUTE = 'api/presentation/qa:generate';
export const PRESENTATION_QA_REVIEW_LOG_ROUTE = 'api/presentation/qa:review';
// generate に渡す「既出の質問」の上限（重複回避用）。
export const PRESENTATION_QA_ASKED_MAX = 10;

// ── AI 即興テーマ生成（/api/presentation/theme）─────────────────────
export const PRESENTATION_THEME_LOG_ROUTE = 'api/presentation/theme';
export const PRESENTATION_THEME_MAX_TOKENS = 1200;
// 発表条件・想定質問の件数規約。
export const PRESENTATION_THEME_CONDITIONS_MIN = 3;
export const PRESENTATION_THEME_CONDITIONS_MAX = 6;
export const PRESENTATION_THEME_QUESTIONS_MIN = 3;
export const PRESENTATION_THEME_QUESTIONS_MAX = 5;
// 「別のテーマを作る」で重複回避のために渡す既出テーマの上限。
export const PRESENTATION_THEME_EXCLUDE_MAX = 10;

// 既出「切り口（angle）」の上限。client が直近で出た angle key を送り、server が回転で避ける。
export const PRESENTATION_THEME_EXCLUDE_ANGLE_MAX = 12;

// AI 即興テーマの温度。多様性を優先（Claude の上限 1.0）。JSON 安定性は angle 回転 +
// 厳格な system prompt で担保するため、top_p は既定のまま下げない。
export const PRESENTATION_THEME_TEMPERATURE = 1;

// テーマの「切り口（theme_angle）」候補。同じ大学情報でも毎回違う方向へ振るための回転候補。
//   - key   : 内部識別子（client へ返し、既出 angle の重複回避に使う）。
//   - label : ユーザー表示用の日本語（API が angleLabel として返す。constants は server-only の
//             ため client から直接 import できない＝ラベルは API 経由で渡す）。
//   - guidance: その切り口で作問する際の方向づけ（system prompt に注入）。
export const PRESENTATION_THEME_ANGLES: ReadonlyArray<{
  key: string;
  label: string;
  guidance: string;
}> = [
  {
    key: 'social_issue',
    label: '社会課題',
    guidance:
      '現代日本の社会課題（少子高齢化・労働・格差・孤立・防災など）を主題にする。',
  },
  {
    key: 'local_community',
    label: '地域活性化',
    guidance:
      '特定地域の活性化・まちづくり。ただし「SNS集客」「ゆるキャラ」等の定番に寄せない。',
  },
  {
    key: 'business_problem',
    label: '経営課題',
    guidance: '企業・産業の経営課題（収益構造・人材・事業転換・地場産業など）。',
  },
  {
    key: 'education',
    label: '教育',
    guidance: '学校・学習・教育格差・探究学習・キャリア教育などの教育テーマ。',
  },
  {
    key: 'global',
    label: '国際問題',
    guidance: '国際協力・多文化共生・移民・国際経済・食料/エネルギー安全保障など。',
  },
  {
    key: 'digital',
    label: 'デジタル活用',
    guidance:
      'デジタル技術の社会実装（DX・AI・データ活用・情報倫理）。ただしSNS集客に寄せない。',
  },
  {
    key: 'sustainability',
    label: '環境/SDGs',
    guidance: '環境・資源・気候変動・循環型社会・持続可能性に関するテーマ。',
  },
  {
    key: 'personal_experience',
    label: '自身の経験との接続',
    guidance:
      '高校生自身の経験・部活・探究活動・身近な課題と接続して論じられるテーマ。',
  },
  {
    key: 'faculty_learning',
    label: '志望学部の学びとの接続',
    guidance: '志望学部・学科で学ぶ専門内容と自然に接続するテーマ。',
  },
];
