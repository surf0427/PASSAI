// 本文編集 + 添削 CTA の UI primitive（Phase 2 STEP O 新規）。
//
// 利用箇所:
//   - /essay/structure/[wid]/body
//   - /essay/write/[wid]/body
//
// 責務（**入力 UI のみ**）:
//   - textarea で本文を表示・編集
//   - submit ボタン表示（loading 中は disabled + ラベル切替）
//   - error メッセージ表示
//   - autosave 注記表示
//
// 絶対にやらないこと:
//   - fetch / API call
//   - localStorage / workspace mutation
//   - review push / cache 書き込み
//   - AI route 呼び出し
//
// container page 側が:
//   - body の autosave（updateBody + upsertEssayWorkspace）
//   - 添削 API call + cache hit/miss
//   - appendInitialReview / submitRewriteReview
//   - navigation
//   をすべて担う。本 component は値を受けて表示するだけ。

import { Textarea } from '@/components/ui/Textarea';
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from '@/components/ui/buttonStyles';

type Props = {
  body: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string;
  submitLabel?: string;
  loadingLabel?: string;
  hint?: string;
  rows?: number;
  placeholder?: string;
};

export function EssayBodyEditor({
  body,
  onChange,
  onSubmit,
  loading,
  error,
  submitLabel = '添削する',
  loadingLabel = '添削中…',
  hint,
  rows = 20,
  placeholder = '自分の言葉で本文を書いてください',
}: Props) {
  return (
    <div>
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">本文</p>
        {hint && (
          <p className="text-xs text-gray-500 mb-3">{hint}</p>
        )}
        <Textarea
          value={body}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
        />
      </section>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className={`${BUTTON_BASE} ${BUTTON_VARIANT.primary} ${BUTTON_SIZE.md}`}
        >
          {loading ? loadingLabel : submitLabel}
        </button>
        {error && (
          <p className="mt-3 text-xs text-red-600">{error}</p>
        )}
        <p className="mt-2 text-xs text-gray-400">
          ※ 入力した本文は自動保存されています。
        </p>
      </div>
    </div>
  );
}
