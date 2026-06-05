/**
 * STEP-BILLING-07: /legal/privacy は既存 /privacy への永続 redirect。
 *
 * 既存 /privacy は STEP-BILLING-07 以前から placeholder として公開済み。
 * 二重実装を避けるため、本ファイルでは内容を持たず redirect のみ行う。
 * URL canonical を /legal/* に寄せるか /xxx に寄せるかは BILLING リリース時に決定。
 * 現状は両 URL が機能する状態を作り、後段で片寄せできるようにする。
 */

import { redirect } from 'next/navigation';

export default function LegalPrivacyRedirect(): never {
  redirect('/privacy');
}
