'use client';

// 発表資料（PDF）の pdf.js ビューア。録画画面の左側「発表資料」エリアに収める。
//
// 方針:
//   - PDF のみ pdf.js（pdfjs-dist）で canvas 描画する。画像は呼び出し側（MaterialViewer）が従来どおり <img> 表示。
//   - signed URL は呼び出し側から受け取る（このコンポーネントは Storage / DB / AI / TTL に一切触れない）。
//   - ページ送り・拡大縮小はローカル state のみ。履歴は保存しない。
//   - pdfjs は dynamic import（クライアント専用）で読み込み、SSR 評価と初期バンドル肥大を避ける。
//   - worker を使い、PDF 解析でメインスレッド（＝カメラ録画 UI）をブロックしない。
//
// 注意: 録画処理（MediaRecorder）には一切干渉しない。描画は requestAnimation 相当の軽量更新のみ。

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';

// pdfjs の型（dynamic import のため最小限を自前定義。値は import しない）。
type PdfPageProxy = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel: () => void };
};
type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void>;
};

const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;

// worker 設定は 1 度だけ行う（モジュール内フラグ）。
let workerConfigured = false;

type Status = 'loading' | 'ready' | 'error';

export function MaterialPdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfDocumentProxy | null>(null);
  // 進行中の render を中断するためのハンドル（ページ/ズーム切替の競合対策）。
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [pageInput, setPageInput] = useState('1');
  // コンテナ幅（fit-width 基準）。リサイズで再描画するため state に持つ。
  const [containerWidth, setContainerWidth] = useState(0);

  // ── ドキュメント読み込み（マウント時 / url 単位） ───────────────
  // 親は <MaterialPdfViewer key={url} /> で渡すため、url 変更時はこの component ごと
  // 再マウントされ state は初期値（loading / page=1 / zoom=100）にリセットされる。
  // よって effect 内での同期 setState（リセット）は不要。
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (!workerConfigured) {
          // bundler（Turbopack/webpack）が worker を asset として解決する標準パターン。
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url,
          ).toString();
          workerConfigured = true;
        }

        const loadingTask = pdfjs.getDocument({ url });
        const doc = (await loadingTask.promise) as unknown as PdfDocumentProxy;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      const doc = docRef.current;
      docRef.current = null;
      if (doc) void doc.destroy();
    };
  }, [url]);

  // ── コンテナ幅の追従（モバイル縦並び・リサイズ対応） ───────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── ページ描画（page / zoom / 幅 / 準備完了 が変わるたび） ───────────
  useEffect(() => {
    if (status !== 'ready') return;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || containerWidth <= 0) return;

    let cancelled = false;
    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;

        const base = pdfPage.getViewport({ scale: 1 });
        // 100% = コンテナ幅にフィット。zoom はそこからの倍率。
        const fitScale = containerWidth / base.width;
        const cssScale = fitScale * (zoom / 100);
        const dpr =
          typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const viewport = pdfPage.getViewport({ scale: cssScale * dpr });

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch {
        // render の cancel は例外で抜けるだけ（次の描画が走るため無視）。
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, page, zoom, containerWidth]);

  const goPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), Math.max(1, numPages));
      setPage(clamped);
      setPageInput(String(clamped));
    },
    [numPages],
  );

  const dec = () => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  const inc = () => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="aspect-video overflow-auto rounded-lg border border-slate-200 bg-slate-100"
      >
        {status === 'loading' && (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-slate-500">読み込み中…</p>
          </div>
        )}
        {status === 'error' && (
          <div className="flex h-full w-full items-center justify-center px-4 text-center">
            <p className="text-sm text-slate-500">資料PDFを表示できませんでした</p>
          </div>
        )}
        {/* canvas は ready 後も DOM 維持（再描画で使い回す）。loading/error 時は隠す。 */}
        <div
          className={`flex w-full items-start justify-center ${
            status === 'ready' ? '' : 'hidden'
          }`}
        >
          <canvas ref={canvasRef} />
        </div>
      </div>

      {/* 操作行（ready 時のみ。loading/error 中は触れない） */}
      {status === 'ready' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goPage(page - 1)}
            disabled={page <= 1}
          >
            前へ
          </Button>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={numPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => {
                const n = Number(pageInput);
                if (Number.isFinite(n)) goPage(Math.trunc(n));
                else setPageInput(String(page));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = Number(pageInput);
                  if (Number.isFinite(n)) goPage(Math.trunc(n));
                }
              }}
              aria-label="ページ番号"
              className="w-12 rounded border border-slate-300 px-1.5 py-0.5 text-center text-xs"
            />
            <span>/ {numPages}</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goPage(page + 1)}
            disabled={page >= numPages}
          >
            次へ
          </Button>
          <Button variant="secondary" size="sm" onClick={dec} disabled={zoom <= ZOOM_MIN}>
            縮小
          </Button>
          <span className="text-xs text-slate-500">{zoom}%</span>
          <Button variant="secondary" size="sm" onClick={inc} disabled={zoom >= ZOOM_MAX}>
            拡大
          </Button>
        </div>
      )}
    </div>
  );
}
