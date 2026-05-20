'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import {
  loadRewriteDraft,
  saveRewriteDraft,
  type RewriteDraftRecord,
} from '@/lib/statement/rewrite/rewriteDraftStorage';

type Props = {
  axisId: string;
  axisLabel: string;
  checklist: string[];
};

export function RewriteForm({ axisId, axisLabel, checklist }: Props) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<boolean[]>(() =>
    checklist.map(() => false),
  );
  const [savedFlash, setSavedFlash] = useState(false);

  // localStorage は SSR で読めないため、マウント後に1回だけ読み込んで復元する。
  // mount 前は text='' / checked=[false…] のままなので SSR / 初期 client paint と一致し、
  // hydration mismatch が起きない。
  useEffect(() => {
    const draft = loadRewriteDraft(axisId);
    if (!draft) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setText(draft.text);
    setChecked(checklist.map((item) => draft.checkedItems.includes(item)));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [axisId, checklist]);

  const checkedCount = checked.filter(Boolean).length;
  const canSave = text.trim().length > 0;

  function toggleCheck(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  function handleSave() {
    if (!canSave) return;
    const record: RewriteDraftRecord = {
      text,
      checkedItems: checklist.filter((_, i) => checked[i]),
      updatedAt: new Date().toISOString(),
    };
    saveRewriteDraft(axisId, record);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  }

  return (
    <>
      <Card className="mb-4">
        <Label htmlFor="rewrite-textarea">書き直しエリア</Label>
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          上の問いに答えながら、{axisLabel}を意識して書き直してみましょう。1段落だけでもOKです。
        </p>
        <Textarea
          id="rewrite-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={`${axisLabel}を意識して書き直してみる…`}
          className="leading-relaxed resize-y"
        />
        <p className="text-xs text-slate-400 tabular-nums mt-2">
          {text.length} 文字
        </p>
      </Card>

      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">
            提出前チェックリスト
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            {checkedCount} / {checklist.length}
          </span>
        </div>
        <ul className="space-y-2.5">
          {checklist.map((item, i) => (
            <li key={i}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() => toggleCheck(i)}
                  className="mt-0.5 shrink-0 w-4 h-4 accent-blue-600"
                />
                <span
                  className={`text-sm leading-relaxed ${
                    checked[i] ? 'text-slate-400 line-through' : 'text-slate-700'
                  }`}
                >
                  {item}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!canSave}
          className="flex-1"
        >
          {savedFlash ? '✓ 保存しました' : '保存する'}
        </Button>
        <LinkButton
          href="/statement/edit"
          variant="secondary"
          size="md"
          className="flex-1"
        >
          下書きに戻る
        </LinkButton>
      </div>
    </>
  );
}
