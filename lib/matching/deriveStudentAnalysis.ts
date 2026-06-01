// 活動整理・基本情報・自己分析添削データから StudentAnalysis を導出する。
// wallHittingResult（AI壁打ち結果）があれば、内部で StudentProfile に変換してから読む。
//
// 設計方針:
//   - 外部からの呼び出しシグネチャは互換維持（admission-matching が直接呼ぶ）
//   - 内部では必ず toStudentProfile() を経由する
//   - これにより questions / answers などの working memory が誤って読まれる経路を消す

import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { SelfPR } from '@/types/selfPR';
import type { WallHittingResult } from '@/types/analysis';
import type { StudentAnalysis } from '@/types/matching';
import { toStudentProfile } from '@/lib/studentProfile';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── STEP-AUDIT-TOP1-5-FIX-01: 活動の「質」を読むためのキーワード集 ───────
//
// 旧仕様（count-only）の問題: 「部活 1 件」と「全国大会優勝 + キャプテンの部活 1 件」が
// 同じ AO スコアになる。活動の「数」だけ見て「質」を見ない。
//
// 修正方針: 活動テキスト（description / achievement / role / challenge / action / contestName /
// theme / certificationLevel など）から signal keyword を見つけて quality bonus を加算する。
// AI 化はしない（スコアは deterministic 維持）。重みは小さく刻んで count-only baseline を
// 完全に塗り替えないようにする。

// ── 上位レベルの実績シグナル ─────────────────────────────
// 「全国レベル / 受賞 / 代表」など、AO で明確に強い signal を含むキーワード。
// 1 件ヒットで +2 加点、複数ヒットでも上限 +2（同じ活動内で何度出ても重複加点しない）。
const NATIONAL_LEVEL_PATTERNS = [
  '全国大会', '全国優勝', '日本一', '全国制覇', '全国準優勝',
  'インターハイ', '選抜大会', 'WRO', '甲子園', '国体',
  '全国大会出場', '全国大会出場権', '全国予選',
  '内閣総理大臣', '文部科学大臣', '受賞', '優勝', '日本代表',
];
// 「県大会 / 関東大会 / 地区大会」など 1 段下のレベル。+1 加点。
const REGIONAL_LEVEL_PATTERNS = [
  '県大会', '都大会', '府大会', '道大会',
  '関東大会', '近畿大会', '東海大会', '東北大会', '九州大会', '中国大会', '四国大会',
  '地区大会', '地方大会', 'ブロック大会', '入賞', '準優勝', '3位',
];

// ── リーダーシップ・運営シグナル ─────────────────────────
// AO 評価で重視される「主体性」「リーダー経験」に直結する語。+1 加点。
const LEADERSHIP_PATTERNS = [
  'キャプテン', '部長', '副部長', 'リーダー', '代表',
  '会長', '副会長', '実行委員長', '実行委員', '委員長',
  '創設', '立ち上げ', '主催', '統括', '企画運営',
];

// ── 探究の深さシグナル ─────────────────────────────────
// 研究 / 探究の質を測るシグナル。論文化 / 学会発表 / 出版などは「探究の深さ」+2、
// 仮説 / 調査 / 分析などは +1。
const RESEARCH_DEPTH_HIGH = [
  '論文', '学会発表', '学会', '発表', '研究発表', '研究紀要', '掲載',
  '査読', 'ポスター発表', '口頭発表', '出版', '書籍',
];
const RESEARCH_DEPTH_MID = [
  '仮説', '検証', '実験', '調査', 'インタビュー', 'フィールドワーク',
  'アンケート', '考察', '分析', '統計', 'データ収集',
];

// ── 数値・期間シグナル ────────────────────────────────────
// 「3 年間」「100 人」「50 件」など具体数を含むかは「活動の充実度」signal。+0.5 加点。
// 全角・半角・桁数は問わず数字 + 単位の組合せがあれば 1 件としてカウント。
const NUMERIC_QUANTIFIER = /[\d０-９]+\s*(年|か月|ヶ月|名|人|件|位|回|時間|日|週|本|冊)/;

// 活動 1 件分のテキストを 1 つの string に集約する。
// 個別の field（description / achievement / challenge / action / role / certificationName 等）を
// 順に concat。NG / 質低下の検出ではなく、quality signal の集計が目的なので type-specific な
// field 名だけ拾えれば十分。
function concatActivityText(a: unknown): string {
  if (typeof a !== 'object' || a === null) return '';
  const obj = a as Record<string, unknown>;
  const fields = [
    'description', 'achievement', 'challenge', 'action', 'role', 'reflection',
    'clubName', 'contestName', 'theme', 'destination', 'programContent',
    'certificationName', 'level', 'activityContent', 'activityName',
    'futureConnection', 'output', 'result',
  ];
  return fields
    .map((f) => obj[f])
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
}

// 1 活動分のテキストから quality bonus を計算する。
// 重み付け:
//   - NATIONAL_LEVEL    : +2（上限）
//   - REGIONAL_LEVEL    : +1
//   - LEADERSHIP        : +1
//   - RESEARCH_DEPTH_HI : +2（上限）
//   - RESEARCH_DEPTH_MID: +1
//   - NUMERIC_QUANTIFIER: +0.5
// 同じ category 内で複数ヒットしても上限を超えない（同じ活動の中で「全国優勝」「全国大会」が
// 並んでいても +2 で打ち止め）。
function activityQualityBonus(text: string): number {
  if (!text) return 0;
  let bonus = 0;
  if (NATIONAL_LEVEL_PATTERNS.some((kw) => text.includes(kw))) bonus += 2;
  else if (REGIONAL_LEVEL_PATTERNS.some((kw) => text.includes(kw))) bonus += 1;
  if (LEADERSHIP_PATTERNS.some((kw) => text.includes(kw))) bonus += 1;
  if (RESEARCH_DEPTH_HIGH.some((kw) => text.includes(kw))) bonus += 2;
  else if (RESEARCH_DEPTH_MID.some((kw) => text.includes(kw))) bonus += 1;
  if (NUMERIC_QUANTIFIER.test(text)) bonus += 0.5;
  return bonus;
}

// 活動配列に対する total quality bonus（全活動を flatten して合計）。
// 配列形 / activityData の各 array を unknown[] として受ける。
function totalActivityQualityBonus(activityArrays: unknown[][]): number {
  let total = 0;
  for (const arr of activityArrays) {
    for (const item of arr) {
      total += activityQualityBonus(concatActivityText(item));
    }
  }
  return total;
}

// AI壁打ちの weaknesses テキストから特定の評価軸スコアを下方修正する。
function applyWeaknessAdjustments(
  weaknesses: string[],
  aoScores: { activity: number; inquiry: number; initiative: number; reason: number },
  recScores: { gpa: number; qualification: number; academic: number; reason: number },
): void {
  for (const w of weaknesses) {
    if (w.includes('探究') || w.includes('テーマ')) aoScores.inquiry = clamp(aoScores.inquiry - 1, 0, 5);
    if (w.includes('主体') || w.includes('自発') || w.includes('発案')) aoScores.initiative = clamp(aoScores.initiative - 1, 0, 5);
    if (w.includes('志望理由') || w.includes('一貫')) { aoScores.reason = clamp(aoScores.reason - 1, 0, 5); recScores.reason = clamp(recScores.reason - 1, 0, 5); }
    if (w.includes('評定') || w.includes('学力')) recScores.gpa = clamp(recScores.gpa - 1, 0, 5);
    if (w.includes('資格') || w.includes('検定')) recScores.qualification = clamp(recScores.qualification - 1, 0, 5);
  }
}

export function deriveStudentAnalysis(
  basicInfo: BasicInfo | null,
  activityData: ActivityData | null,
  selfPRs: SelfPR[],
  wallHittingResult?: WallHittingResult | null,
): StudentAnalysis {
  // 自己分析は受信時点で StudentProfile に変換し、以降はこの profile だけを読む。
  // 外部シグネチャは互換のため WallHittingResult のまま受けるが、内部参照は profile 側で完結する。
  const studentProfile = wallHittingResult ? toStudentProfile(wallHittingResult) : null;

  // 活動データがない場合はスコアを計算できない
  if (!activityData) {
    return {
      strengths: studentProfile?.strengths ?? [],
      weaknesses: studentProfile?.weaknesses ?? [],
      aoScoreProfile: null,
      recommendationScoreProfile: null,
    };
  }

  // ── 活動数カウント ────────────────────────────────────────────
  const clubCount        = activityData.clubActivities.length;
  const volunteerCount   = activityData.volunteerActivities.length;
  const researchCount    = activityData.researchActivities.length;
  const contestCount     = activityData.contestActivities.length;
  const certCount        = activityData.certificationActivities.length;
  const abroadCount      = activityData.studyAbroadActivities.length;
  const otherCount       = activityData.otherActivities.length;

  const totalActivities = clubCount + volunteerCount + researchCount + contestCount + abroadCount + activityData.partTimeJobActivities.length + otherCount;

  // ── STEP-AUDIT-TOP1-5-FIX-01: 活動の「質」シグナル ───────────────
  // 旧 count-only baseline では「部活 1 件」と「全国大会優勝 + キャプテンの部活 1 件」が同じ
  // AO スコアになる問題があった。activity / inquiry / initiative の 3 軸に quality bonus を
  // 重み付きで載せる（reason は AI 壁打ち / 志望理由書側の責務なので触らない）。
  //
  //   activity   : 全活動の bonus 合計（実績・期間・規模が出る）
  //   inquiry    : research / contest の text に対する RESEARCH_DEPTH_* と NATIONAL_LEVEL_* 加点
  //   initiative : 全活動の text に対する LEADERSHIP 加点
  // bonus は count-only baseline の上に上乗せ（clamp は 0-5 のまま）。
  const allActivityQuality = totalActivityQualityBonus([
    activityData.clubActivities,
    activityData.volunteerActivities,
    activityData.researchActivities,
    activityData.contestActivities,
    activityData.partTimeJobActivities,
    activityData.studyAbroadActivities,
    activityData.otherActivities,
  ]);
  const inquiryQuality = totalActivityQualityBonus([
    activityData.researchActivities,
    activityData.contestActivities,
  ]);
  const leadershipText = [
    ...activityData.clubActivities,
    ...activityData.volunteerActivities,
    ...activityData.researchActivities,
    ...activityData.contestActivities,
    ...activityData.otherActivities,
  ]
    .map((a) => concatActivityText(a))
    .join(' ');
  const initiativeQuality = LEADERSHIP_PATTERNS.some((kw) => leadershipText.includes(kw)) ? 2 : 0;

  // ── AO スコア（count-only baseline + quality bonus） ────────────
  const aoScores = {
    activity:   clamp(totalActivities + allActivityQuality * 0.5, 0, 5),
    inquiry:    clamp(researchCount * 2 + inquiryQuality, 0, 5),
    initiative: clamp(
      1 + (clubCount > 0 ? 2 : 0) + (contestCount > 0 ? 1 : 0) + (volunteerCount > 0 ? 1 : 0) + initiativeQuality,
      0,
      5,
    ),
    reason:     3,
  };

  // ── 推薦スコア（ヒューリスティック） ─────────────────────────
  // 推薦は「資格・学力・GPA」中心のため、quality bonus は contest / abroad の academic 軸にだけ
  // 控えめに反映する。資格は currently level（英検 1 級 / 準 1 級など）情報が text に出やすいので、
  // certActivities 全体の quality bonus を qualification にも軽く乗せる。
  const certQuality = totalActivityQualityBonus([activityData.certificationActivities]);
  const academicQuality = totalActivityQualityBonus([
    activityData.contestActivities,
    activityData.studyAbroadActivities,
  ]);
  const recScores = {
    gpa:           3,
    qualification: clamp(certCount * 2 + certQuality * 0.5, 0, 5),
    academic:      clamp(contestCount + abroadCount + 1 + academicQuality * 0.5, 0, 5),
    reason:        3,
  };

  // ── AI壁打ち結果で弱点調整 ──────────────────────────────────
  // 弱点テキストのキーワードマッチで AO/推薦スコアを下方修正する。
  // StudentProfile.weaknesses は WallHittingResult.weaknesses を sanitize したものなので、
  // キーワードの一致挙動は従来と等価。
  if (studentProfile?.weaknesses?.length) {
    applyWeaknessAdjustments(studentProfile.weaknesses, aoScores, recScores);
  }

  // ── 強み・弱みテキスト ─────────────────────────────────────────
  // AI壁打ち結果があればそちらを優先（より具体的）
  let strengths: string[];
  let weaknesses: string[];

  if (studentProfile) {
    strengths = studentProfile.strengths;
    weaknesses = studentProfile.weaknesses;
  } else {
    strengths = [];
    weaknesses = [];
    if (clubCount > 0)      strengths.push('部活動での継続的な経験がある');
    if (researchCount > 0)  strengths.push('探究活動への取り組みがある');
    if (contestCount > 0)   strengths.push('コンテスト参加による挑戦経験がある');
    if (abroadCount > 0)    strengths.push('留学・国際経験がある');
    if (volunteerCount > 0) strengths.push('ボランティア活動による貢献意識がある');
    if (certCount > 0)      strengths.push('資格取得による自己研鑽がある');
    const latestPR = selfPRs.findLast((pr) => pr.latestResult);
    if (latestPR) strengths.push('自己分析を言語化できている');
    if (aoScores.inquiry < 2)  weaknesses.push('探究テーマの深掘りが不足している');
    if (aoScores.activity < 2) weaknesses.push('課外活動の経験が少ない');
  }

  return {
    strengths,
    weaknesses,
    aoScoreProfile: aoScores,
    recommendationScoreProfile: recScores,
  };
}
