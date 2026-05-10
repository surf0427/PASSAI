import { redirect } from 'next/navigation';

// /essay は将来の正式URLとして確保している。
// 現在の実装は /essay-practice にあるため、そちらにリダイレクトする。
export default function EssayPage() {
  redirect('/essay-practice');
}
