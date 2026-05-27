// issueId のパース（STEP E 新規）。
//
// issueId 規約（STEP D で確定）:
//   - review.improvement     → 'r{reviewIndex}-improvement'
//   - review.weakPoints[i]   → 'r{reviewIndex}-w{i}'
//
// 役割:
//   /essay/improve/[wid]/deep/[issueId] の page で issueId から reviewIndex /
//   weakPointIndex / kind を取り出す。STEP G の submitRewriteReview で
//   sourceIssueId を扱う際にも再利用する想定。
//
// 設計:
//   - parse 失敗（不正なフォーマット）は null を返す。throw しない
//   - reviewIndex / weakPointIndex の値が valid な範囲かは呼び出し側で判定
//     （workspace.reviews.length / weakPoints.length と比較する）

export type ParsedIssueId =
  | { kind: 'improvement'; reviewIndex: number }
  | { kind: 'weakPoint'; reviewIndex: number; weakPointIndex: number };

export function parseIssueId(issueId: string): ParsedIssueId | null {
  const mImp = issueId.match(/^r(\d+)-improvement$/);
  if (mImp) {
    return { kind: 'improvement', reviewIndex: parseInt(mImp[1], 10) };
  }
  const mWeak = issueId.match(/^r(\d+)-w(\d+)$/);
  if (mWeak) {
    return {
      kind: 'weakPoint',
      reviewIndex: parseInt(mWeak[1], 10),
      weakPointIndex: parseInt(mWeak[2], 10),
    };
  }
  return null;
}
