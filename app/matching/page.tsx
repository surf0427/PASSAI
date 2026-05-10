import { redirect } from 'next/navigation';

// 正式URLは /admission-matching に統一した。
// 旧URLからのリンクやブックマークを壊さないためにリダイレクトを残す。
export default function MatchingPage() {
  redirect('/admission-matching');
}
