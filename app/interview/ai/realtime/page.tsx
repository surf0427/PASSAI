import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { RealtimeInterviewClient } from './RealtimeInterviewClient';

// STEP-INTERVIEW-AI-REALTIME-PR2: リアルタイム音声面接ページ（WebRTC 接続確認のみ）。
//   - flag 判定は client（RealtimeInterviewClient）側で行う（Preview の ?realtime=1 を効かせるため）。
//     本番 passai.jp は flag OFF で「無効」表示になり、token route の server flag が最終ゲート。
//   - 既存 /interview/ai（ターン制）とは別ルート。既存ページ・Client は一切共有しない。
export default function RealtimeInterviewPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/interview"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-4 py-2 transition-colors mb-8"
      >
        ← 面接練習トップへ戻る
      </Link>

      <PageHeader
        title="リアルタイム音声面接（β）"
        description="AI面接官と音声でリアルタイムに会話します。STEP2 では接続確認のみを行います。"
        className="mb-8"
      />

      <RealtimeInterviewClient />
    </div>
  );
}
