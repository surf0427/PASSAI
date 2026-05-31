'use client';

// マイページのスコア折れ線（pure SVG）。
//
// 設計理由:
//   - 依存追加なしで描く。本機能のためだけに recharts / chart.js を入れない。
//   - y 軸は 0〜100 固定（志望理由書 5 軸×20 / 小論文 totalScore は両方 0〜100）。
//   - x 軸は points の最古 → 最新までの線形マッピング。等間隔配置にはしない
//     （日付間隔が極端なケースは「いつ追い込んだか」が見える方が誠実）。
//   - tooltip は最小限。最後の点だけ値ラベルを横に出す。
//   - 0 件: プレースホルダ表示。1 件: 単独ドット + 「ベースライン」表示。
//
// 拡張余地:
//   - hover でツールチップ
//   - x 軸日付ラベル
//   - workspaceId 別の色分け（小論文）
//   いずれも MVP では出さない。

import type { ReactNode } from 'react';

export type ChartPoint = {
  createdAt: string;
  total: number;
};

type Props = {
  title: string;
  points: ChartPoint[];
  color: string; // tailwind の色じゃなく素の CSS color（SVG 用）
  emptyHint: ReactNode;
};

const VIEW_W = 600;
const VIEW_H = 200;
const PAD_LEFT = 36;
const PAD_RIGHT = 56; // 末尾の値ラベル分
const PAD_TOP = 16;
const PAD_BOTTOM = 24;
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

const Y_TICKS = [0, 25, 50, 75, 100];

export function ScoreLineChart({ title, points, color, emptyHint }: Props) {
  // 0 件 → プレースホルダ
  if (points.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-2">{title}</p>
        <p className="text-xs text-slate-500">{emptyHint}</p>
      </div>
    );
  }

  // x 座標を date で線形に並べる。1 件のときは中央配置。
  const first = new Date(points[0].createdAt).getTime();
  const last = new Date(points[points.length - 1].createdAt).getTime();
  const span = Math.max(1, last - first);

  const projected = points.map((p) => {
    const t = new Date(p.createdAt).getTime();
    const x =
      points.length === 1
        ? PAD_LEFT + PLOT_W / 2
        : PAD_LEFT + ((t - first) / span) * PLOT_W;
    const y = PAD_TOP + (1 - p.total / 100) * PLOT_H;
    return { x, y, total: p.total, createdAt: p.createdAt };
  });

  const pathD = projected
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const latest = projected[projected.length - 1];

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 sm:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="text-xs text-slate-500">{points.length}件の履歴</p>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`${title} スコア推移`}
        className="w-full h-auto"
        preserveAspectRatio="none"
      >
        {/* y 軸グリッド */}
        {Y_TICKS.map((v) => {
          const y = PAD_TOP + (1 - v / 100) * PLOT_H;
          return (
            <g key={v}>
              <line
                x1={PAD_LEFT}
                x2={PAD_LEFT + PLOT_W}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#94a3b8"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* x 軸（最古 / 最新の日付） */}
        <text
          x={PAD_LEFT}
          y={VIEW_H - 6}
          textAnchor="start"
          fontSize="10"
          fill="#94a3b8"
        >
          {formatYmd(points[0].createdAt)}
        </text>
        {points.length > 1 && (
          <text
            x={PAD_LEFT + PLOT_W}
            y={VIEW_H - 6}
            textAnchor="end"
            fontSize="10"
            fill="#94a3b8"
          >
            {formatYmd(points[points.length - 1].createdAt)}
          </text>
        )}

        {/* 折れ線 */}
        {points.length >= 2 && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* ドット */}
        {projected.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === projected.length - 1 ? 5 : 3.5}
            fill={color}
          />
        ))}

        {/* 末尾の値ラベル */}
        <text
          x={latest.x + 10}
          y={latest.y + 4}
          fontSize="12"
          fontWeight="600"
          fill={color}
        >
          {latest.total}
        </text>

        {/* 1 件のみ: 「ベースライン」表記 */}
        {points.length === 1 && (
          <text
            x={latest.x}
            y={latest.y - 12}
            textAnchor="middle"
            fontSize="10"
            fill="#64748b"
          >
            ベースライン
          </text>
        )}
      </svg>
    </div>
  );
}

function formatYmd(iso: string): string {
  // ISO の先頭 YYYY-MM-DD を M/D に整形（タイムゾーン解釈に依存しない）。
  if (iso.length < 10) return '';
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!Number.isFinite(m) || !Number.isFinite(d)) return '';
  return `${m}/${d}`;
}
