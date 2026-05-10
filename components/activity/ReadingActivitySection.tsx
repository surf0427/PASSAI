import { useState, useRef, useEffect } from 'react';
import type { ReadingActivity } from '@/types/activity';
import { ActivityCard } from './ActivityCard';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FormField } from '@/components/ui/FormField';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';

const ERROR_INPUT_CLASS = '!border-red-400 focus:!ring-red-400';
const TEXTAREA_CLASS = 'resize-none min-h-[80px]';

type Props = {
  activities: ReadingActivity[];
  errors?: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof Omit<ReadingActivity, 'type'>, value: string) => void;
};

export default function ReadingActivitySection({ activities, errors, onAdd, onRemove, onUpdate }: Props) {
  const [isOpen, setIsOpen] = useState(activities.length > 0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const atLimit = activities.length >= 3;
  const prevLen = useRef(activities.length);
  useEffect(() => {
    if (activities.length > prevLen.current) setEditingIndex(activities.length - 1);
    prevLen.current = activities.length;
  }, [activities.length]);

  function handleAdd() {
    if (atLimit) return;
    setIsOpen(true);
    onAdd();
  }

  function confirmRemove(index: number) {
    if (!window.confirm('この活動を削除しますか？\nこの操作は元に戻せません。')) return;
    setEditingIndex(null);
    onRemove(index);
  }

  return (
    <section className="mb-4 border border-gray-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-sm font-semibold text-gray-700">読書</span>
          {activities.length > 0 && (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
              {activities.length}件
            </span>
          )}
          {errors && errors.length > 0 && (
            <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full shrink-0">
              要確認
            </span>
          )}
          <svg
            className={`ml-auto w-4 h-4 text-gray-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={atLimit}
          className="ml-3 shrink-0"
        >
          ＋ 追加{atLimit ? '（上限3件）' : ''}
        </Button>
      </div>

      {isOpen && (
        <div className="border-t border-gray-100 px-4 pt-3 pb-4">
          {errors && errors.length > 0 && (
            <AlertBox variant="error" className="mb-3">
              <ul className="space-y-1">
                {errors.map((e, i) => <li key={i} className="text-sm text-red-600">{e}</li>)}
              </ul>
            </AlertBox>
          )}
          {activities.length === 0 && (
            <p className="text-sm text-gray-400 py-2">＋追加ボタンで入力欄を追加できます</p>
          )}
          <div className="space-y-4">
            {activities.map((activity, index) => {
              const hasError = errors?.some(e => e.startsWith(`読書${index + 1}:`)) ?? false;
              return (
                <ActivityCard
                  key={index}
                  label={`読書 ${index + 1}`}
                  summary={activity.favoriteBook}
                  isEditing={editingIndex === index}
                  onEdit={() => setEditingIndex(index)}
                  onDone={() => setEditingIndex(null)}
                  onRemove={() => confirmRemove(index)}
                >
                  <FormField label="本のジャンル">
                    <Input
                      type="text"
                      value={activity.genre}
                      onChange={(e) => onUpdate(index, 'genre', e.target.value)}
                      placeholder="例：歴史、科学、小説"
                    />
                  </FormField>
                  <FormField label="印象に残った本" required>
                    <Input
                      type="text"
                      value={activity.favoriteBook}
                      onChange={(e) => onUpdate(index, 'favoriteBook', e.target.value)}
                      placeholder="書名と著者名"
                      className={hasError ? ERROR_INPUT_CLASS : ''}
                    />
                  </FormField>
                  <FormField
                    label="印象に残っていること"
                    hint="短くても大丈夫です。一言からでもOK。"
                  >
                    <Textarea
                      value={activity.mindChange}
                      onChange={(e) => onUpdate(index, 'mindChange', e.target.value)}
                      placeholder="読んで印象に残っていること・考え方の変化など"
                      className={TEXTAREA_CLASS}
                    />
                  </FormField>
                  <FormField label="うまくいったこと">
                    <Textarea
                      value={activity.reflection}
                      onChange={(e) => onUpdate(index, 'reflection', e.target.value)}
                      placeholder="読書を通じて得たこと・よかったことなど"
                      className={TEXTAREA_CLASS}
                    />
                  </FormField>
                </ActivityCard>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
