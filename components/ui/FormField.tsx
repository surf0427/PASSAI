import { cloneElement, useId, type ReactElement } from 'react';

// PASSAI Design System v1 — FormField
//
// 目的:
//   入力フォームの「label / 必須印 / hint / 入力欄 / error」の縦並びを
//   1 パーツに固定化し、ページ間のフォーム見た目のドリフトを止める。
//
// 高校生向けの安心感を出すため、hint を出しやすい構造にしている。
//   例: 「短くてOK」「100文字以内で大丈夫です」「あとでAIが整理します」
//
// 表示順（仕様）:
//   1. label（required="*" 付き）
//   2. hint（label のすぐ下、淡色の小さい補助文）
//   3. children（<Input> / <Textarea> / <select> など）
//   4. error（赤字、role="alert"）
//
// アクセシビリティ:
//   - label は <label htmlFor="..."> として子要素の id と紐付ける。
//     children に id が無い場合、useId() 由来の id を自動付与する。
//   - error がある場合は子要素に aria-invalid="true" と aria-describedby を伝播。
//
// 注意:
//   children は単一の input 系要素を想定（複数 children や複雑な構造は
//   想定外）。

type FieldChildProps = {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

type Props = {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /**
   * 子要素に渡す id を明示したい場合に指定。
   * 省略時は useId() で自動生成される。
   */
  htmlFor?: string;
  children: ReactElement<FieldChildProps>;
};

export function FormField({
  label,
  required = false,
  hint,
  error,
  htmlFor,
  children,
}: Props) {
  // 子要素に id が無くても label と紐付くように、自動生成 id を予約。
  const reactId = useId();
  const fieldId = htmlFor ?? children.props.id ?? `field-${reactId}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter(Boolean).join(' ') || undefined;

  // 子要素にアクセシビリティ属性を付与（cloneElement で型安全に）。
  const enhancedChild = cloneElement<FieldChildProps>(children, {
    id: children.props.id ?? fieldId,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-describedby': describedBy ?? children.props['aria-describedby'],
  });

  return (
    <div className="space-y-2">
      <label
        htmlFor={fieldId}
        className="block text-sm font-semibold text-slate-800"
      >
        {label}
        {required && (
          <span
            className="ml-1.5 text-xs font-medium text-red-600"
            aria-label="必須"
          >
            *
          </span>
        )}
      </label>

      {hint && (
        <p
          id={hintId}
          className="text-xs text-slate-500 leading-relaxed"
        >
          {hint}
        </p>
      )}

      {enhancedChild}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-red-600 leading-relaxed"
        >
          {error}
        </p>
      )}
    </div>
  );
}
