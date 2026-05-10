import { redirect } from 'next/navigation';

// 正式URLは /self-analysis に統一した。
// 旧URLからのリンクやブックマークを壊さないためにリダイレクトを残す。
export default function AnalyzePage() {
  redirect('/self-analysis');
}
