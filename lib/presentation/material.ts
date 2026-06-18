// 発表資料（material）の共有定数。client（setup の選択検証）と server（登録 / evaluate）双方で使う。
// server-only にしない（client から import するため）。純粋な定数・関数のみ。

export const PRESENTATION_MATERIAL_BUCKET = 'presentation-materials';

// 最大 10MB・1 ファイル（任意）。
export const PRESENTATION_MATERIAL_MAX_BYTES = 10 * 1024 * 1024;

// 許可 MIME → Storage パス拡張子。PDF（必須）/ PNG / JPG / JPEG（jpg/jpeg はともに image/jpeg）。
// PPTX は今回未対応（将来追加予定）。
export const MATERIAL_MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

// input[accept] 用。
export const MATERIAL_ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

export function materialExt(mime: string): string | null {
  return MATERIAL_MIME_EXT[mime] ?? null;
}

export function isAllowedMaterialMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MATERIAL_MIME_EXT, mime);
}
