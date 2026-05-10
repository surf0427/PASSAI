// サーバ側 rate limit の汎用ヘルパー（暫定実装）。
//
// 注意：これはプロセスメモリ上の Map を使った暫定実装である。
//   - Vercel serverless / Edge / 多インスタンス環境ではインスタンスごとにメモリが分離されるため、
//     インスタンス間で count が共有されない（実効上限は インスタンス数 × maxRequests）
//   - cold start / 再デプロイで Map が空に戻る
//   - 失効 entry の本格的な掃除（LRU 等）はしていない。Map.size が閾値を超えた時に
//     resetAt < now のものだけ走査削除する軽い処理のみ
//
// 本番では DB / Redis / Upstash / Vercel KV / Supabase 等で、
// ユーザーIDまたはIPベースの永続制限に置き換えるべき。
// この helper の関数シグネチャは保ち、内部実装だけを差し替える前提で書いている。

type RateLimitEntry = { count: number; resetAt: number };

// モジュールスコープのバケット。複数 API で共有する想定（key を keyPrefix で名前空間分離）。
const rateLimitMap = new Map<string, RateLimitEntry>();

// この件数を超えたら、失効 entry の軽い掃除を起動する閾値。
// 1リクエスト毎に走査するとオーバーヘッドが出るので「ある程度溜まったら一括掃除」する。
const CLEANUP_THRESHOLD = 200;

export type ServerRateLimitOptions = {
  // map key の名前空間。API ごとに違う値を渡す（例: 'statement-prepare'）。
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
};

export type ServerRateLimitResult = {
  allowed: boolean;
  // allowed=false のときに Retry-After ヘッダで返す秒数。allowed=true のときは 0。
  retryAfterSec: number;
  // バケット key（"<keyPrefix>:<ip>"）。デバッグ・ログ用。
  key: string;
};

// クライアント IP を request ヘッダから推定する。
//   1) x-forwarded-for（"client, proxy1, ..." 形式の場合は先頭をクライアントとみなす）
//   2) x-real-ip
//   3) どちらも無ければ "unknown"（=ローカル開発・proxy が IP を落とす環境では集約される）
function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

// 失効 entry を 1 パスで削除する。Map.size が閾値を超えたときだけ呼ばれる想定。
function pruneExpired(now: number): void {
  for (const [k, entry] of rateLimitMap) {
    if (entry.resetAt <= now) rateLimitMap.delete(k);
  }
}

// ウインドウ内の上限を超えていなければ count を進めて allowed=true を返す。
// 超えていれば allowed=false と「次のリセットまでの秒数」を返す（Retry-After 用）。
//
// 仕様：
//   - resetAt を超過していたら count=1 / resetAt=now+windowMs にリセットして allowed=true
//   - count >= maxRequests なら allowed=false（count は増やさない）
//   - それ以外は count += 1 して allowed=true
//   - つまり「API 処理に進む場合のみ count が進む」
export function checkServerRateLimit(
  req: Request,
  options: ServerRateLimitOptions,
): ServerRateLimitResult {
  const now = Date.now();
  const ip = getClientIp(req);
  const key = `${options.keyPrefix}:${ip}`;

  // 軽い掃除（閾値超え時のみ）。挙動には影響しない、メモリ保護目的。
  if (rateLimitMap.size > CLEANUP_THRESHOLD) {
    pruneExpired(now);
  }

  const entry = rateLimitMap.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSec: 0, key };
  }

  if (entry.count >= options.maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfterSec, key };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSec: 0, key };
}
