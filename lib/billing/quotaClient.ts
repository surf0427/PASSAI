'use client';

/**
 * STEP-BILLING-07: client から fetch した AI route の Response を見て
 * 402 quota-exceeded を構造化エラーとして抽出するヘルパ。
 *
 * 目的:
 *   各 AI 機能の client (statement / essay / tutor / interview 等) が
 *   個別に "402 を見つけたら何を表示するか" を実装しなくて済むように、
 *   "判定 + ダイアログ表示" の責務を [QuotaExceededDialog] と [useQuotaDialog] に集約する。
 *
 * 使い方:
 *   const { handleResponse, dialog } = useQuotaDialog();
 *   const res = await fetch('/api/statement-review', { ... });
 *   if (await handleResponse(res)) return;     // ← 402 ならダイアログを開いて true
 *   // 200 系の通常処理
 *   ...
 *   return (<> { existingUi } { dialog } </>);
 */

import { isQuotaFeature, type QuotaFeature } from './quotas';
import type { EffectivePlan } from './quotas';

export type QuotaErrorInfo = {
  plan: EffectivePlan;
  feature: QuotaFeature;
  used: number;
  limit: number;
};

/**
 * Response を読んで 402 quota-exceeded ならパース、それ以外なら null。
 *
 * - 200/4xx (それ以外) / 5xx は null を返す。呼び出し側は通常の error handling を続ける。
 * - body 形が壊れていたら null (defensive)。
 * - res.clone() で消費しないため、呼び出し側が後で res.json() しても安全。
 */
export async function parseQuotaError(
  res: Response,
): Promise<QuotaErrorInfo | null> {
  if (res.status !== 402) return null;

  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;

  const obj = body as Record<string, unknown>;
  if (obj.error !== 'quota-exceeded') return null;
  if (typeof obj.used !== 'number' || typeof obj.limit !== 'number') return null;
  if (!isQuotaFeature(obj.feature)) return null;

  const plan: EffectivePlan =
    obj.plan === 'basic' || obj.plan === 'premium' ? obj.plan : 'free';

  return {
    plan,
    feature: obj.feature,
    used: obj.used,
    limit: obj.limit,
  };
}
