// djb2 系の軽量文字列 hash を base36 で表現する共通 helper。
//
// 役割:
//   lib/aiInputHash.ts（AI route の input hash 計算）と
//   lib/studentProfile.ts（StudentProfile.sourceHash 計算）の双方で
//   同一の hash 関数を使うための集約先。
//
// 重要:
//   - 値計算は変更しない（STEP-D で物理重複を解消するためだけの集約）
//   - 入力は事前に文字列化済みであることを呼び出し側に要求する
//     （stableStringify の有無は呼び出し側の責務）
//   - crypto を使わないのは、Node / Edge / Browser のいずれの環境でも動かすため
//     + 外部ライブラリ追加禁止
//   - 衝突耐性は要求しない（cache / 再生成判定の用途のみ。衝突しても miss 扱い）
export function djb2(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
