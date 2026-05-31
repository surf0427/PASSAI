import type { ActivityData } from '@/types/activity';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

// 【保存先】localStorage（ブラウザを閉じても残る）
// 【用途】活動整理フォームの入力途中データを保持する
// 　　　　ページを離れても再開できるようにするための保存
// 【注意】AI分析に渡す「提出済みデータ」は sessionStorage の 'activityData' キーに別途保存される
// 　　　　→ この2つは別物なので混同しないこと
const STORAGE_KEY = 'activityFormData';

// Dedup gate — same-content re-save 抑制のための最小仕掛け。
//
// 目的:
//   double Reset / hydration replay edge case / React 18 strict-mode の dev
//   double-effect などで「直前と同一 content」の autosave が連続して走るケースを
//   no-op に倒し、無駄な localStorage write を避ける。
//
// 制約 — dedup gate **だけ** では per-keystroke autosave flood は解決しない:
//   keystroke ごとに in-memory state の content が変わるため
//   `JSON.stringify(prev) !== JSON.stringify(next)` は常に true になる。
//   将来 mirror を配線する際の flood 対策（submit-driven trigger 等）は別 STEP。
//   詳細は docs/supabase/feature_rollout_matrix.md row 3 を参照。
//
// 設計 — raw shape equality:
//   activityData は現状 normalize / prune helper を持たず、保存形は in-memory
//   state と byte-identical。dedup も生 shape の `JSON.stringify` で比較するこ
//   とで `lib/aiInputHash.ts` で hash 化される shape との一貫性を保つ。
//
// cache:
//   `lastSavedJson` は module-local の optimization。canonical は依然として
//   localStorage であり、cache miss しても誤動作はしない（dedup が通常通り
//   効かないだけで、結果として safeSetStorage が一度走るのみ）。
//   cross-tab 同期は意図的にしない（multi-tab race は canonical 側の既存挙動
//   に従う）。
let lastSavedJson: string | undefined;

// canonical 同一性判定。caller が「save する価値があるか」を事前判断するため
// の純粋関数。本ファイル内の saveActivityData は別途 lastSavedJson による
// in-memory dedup を行うため、caller 側で本関数を呼ぶ義務は無いが、
// localStorage を読み返してから次の write を判断したいケース（将来の mirror
// 配線時など）に備えて公開する。
export function shouldUpdateActivityData(
  prev: ActivityData | null,
  next: ActivityData,
): boolean {
  if (prev === null) return true;
  return JSON.stringify(prev) !== JSON.stringify(next);
}

export function saveActivityData(data: ActivityData): void {
  const json = JSON.stringify(data);
  if (json === lastSavedJson) return;
  lastSavedJson = json;
  safeSetStorage(STORAGE_KEY, data);
}

// 旧バージョンで保存された ActivityData に新規追加されたカテゴリ配列が
// 欠落していても下流が `data.xxxActivities.length` 等で落ちないよう、
// 全カテゴリ配列が必ず存在する形に正規化する。
function normalizeActivityData(value: ActivityData): ActivityData {
  return {
    clubActivities: value.clubActivities ?? [],
    volunteerActivities: value.volunteerActivities ?? [],
    studyAbroadActivities: value.studyAbroadActivities ?? [],
    researchActivities: value.researchActivities ?? [],
    partTimeJobActivities: value.partTimeJobActivities ?? [],
    certificationActivities: value.certificationActivities ?? [],
    contestActivities: value.contestActivities ?? [],
    readingActivities: value.readingActivities ?? [],
    hobbyActivities: value.hobbyActivities ?? [],
    otherActivities: value.otherActivities ?? [],
  };
}

export function loadActivityData(): ActivityData | null {
  const raw = safeGetStorage<ActivityData | null>(STORAGE_KEY, null);
  if (raw === null) return null;
  const value = normalizeActivityData(raw);
  // ページロード直後の最初の autosave が「保存済 content と同一」なら no-op に
  // なるよう cache を同期する。normalize で fill された空配列を含む shape を
  // 基準にすることで、次の save も byte-identical の場合だけ dedup が効く。
  lastSavedJson = JSON.stringify(value);
  return value;
}

export function clearActivityData(): void {
  // canonical を消す以上、cache も無効化する。次の save は dedup を通過する。
  lastSavedJson = undefined;
  safeRemoveStorage(STORAGE_KEY);
}
