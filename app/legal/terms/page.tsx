/**
 * STEP-BILLING-07: /legal/terms は既存 /terms への永続 redirect。
 *
 * 既存 /terms は STEP-BILLING-07 以前から placeholder として公開済み。
 * 二重実装を避けるため redirect のみ。canonical URL の決定は別 STEP。
 */

import { redirect } from 'next/navigation';

export default function LegalTermsRedirect(): never {
  redirect('/terms');
}
