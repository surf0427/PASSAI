'use client';

// 大学選択画面。志望大学・学部・入試方式・プレゼン形式・制限時間・備考を手入力し、
// localStorage に保存して setup 画面へ渡す。大学DB検索・外部取得はしない（手入力方式）。

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  ADMISSION_TYPES,
  EMPTY_UNIVERSITY_SELECTION,
  loadUniversitySelection,
  PRESENTATION_FORMATS,
  saveUniversitySelection,
  type UniversitySelection,
} from '@/lib/presentation/universitySelection';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

import { PresentationPremiumGate } from '../PresentationPremiumGate';

const NAME_MAX = 200;
const NOTES_MAX = 2000;
const MINUTES_MAX = 60;

export function PresentationUniversityClient() {
  // 初期値は保存済み選択（あれば）で復元。useState 初期化関数で 1 回だけ読む。
  const [sel, setSel] = useState<UniversitySelection>(
    () => loadUniversitySelection() ?? EMPTY_UNIVERSITY_SELECTION,
  );
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function update<K extends keyof UniversitySelection>(
    key: K,
    value: UniversitySelection[K],
  ) {
    setSel((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sel.universityName.trim()) {
      setError('大学名を入力してください。');
      return;
    }
    // 制限時間（任意）は入力があれば 1〜60 分の整数のみ許可。
    if (sel.limitMinutes.trim()) {
      const m = Number(sel.limitMinutes);
      if (!Number.isInteger(m) || m < 1 || m > MINUTES_MAX) {
        setError(`制限時間は 1〜${MINUTES_MAX} 分の整数で入力してください。`);
        return;
      }
    }

    const normalized: UniversitySelection = {
      ...sel,
      universityName: sel.universityName.trim(),
      facultyName: sel.facultyName.trim(),
      departmentName: sel.departmentName.trim(),
      notes: sel.notes.trim(),
    };
    saveUniversitySelection(normalized);
    router.push('/presentation/setup');
  }

  return (
    <PresentationPremiumGate>
      <Card padding="lg">
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <FormField label="大学名" required>
            <Input
              value={sel.universityName}
              onChange={(e) => update('universityName', e.target.value)}
              maxLength={NAME_MAX}
              placeholder="例: ◯◯大学"
            />
          </FormField>

          <FormField label="学部名" hint="任意">
            <Input
              value={sel.facultyName}
              onChange={(e) => update('facultyName', e.target.value)}
              maxLength={NAME_MAX}
              placeholder="例: ◯◯学部"
            />
          </FormField>

          <FormField label="学科名" hint="任意">
            <Input
              value={sel.departmentName}
              onChange={(e) => update('departmentName', e.target.value)}
              maxLength={NAME_MAX}
              placeholder="例: ◯◯学科"
            />
          </FormField>

          <FormField label="入試方式" hint="任意">
            <select
              value={sel.admissionType}
              onChange={(e) => update('admissionType', e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">未選択</option>
              {ADMISSION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="プレゼン形式" hint="任意">
            <select
              value={sel.presentationFormat}
              onChange={(e) => update('presentationFormat', e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">未選択</option>
              {PRESENTATION_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="制限時間（分）" hint={`任意・1〜${MINUTES_MAX} 分`}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={MINUTES_MAX}
              value={sel.limitMinutes}
              onChange={(e) => update('limitMinutes', e.target.value)}
              placeholder="例: 5"
            />
          </FormField>

          <FormField label="備考" hint="任意（入試方式の特徴・指定条件など）">
            <Textarea
              value={sel.notes}
              onChange={(e) => update('notes', e.target.value)}
              maxLength={NOTES_MAX}
              rows={4}
              placeholder="例: 質疑応答あり / 資料は3枚以内 など"
            />
          </FormField>

          {error && <AlertBox variant="error">{error}</AlertBox>}

          <Button type="submit" variant="primary">
            この内容で次へ
          </Button>
        </form>
      </Card>
    </PresentationPremiumGate>
  );
}
