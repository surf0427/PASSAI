import { useState, useRef, useEffect } from 'react';
import type { VolunteerActivity } from '@/types/activity';
import { ActivityCard } from './ActivityCard';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FormField } from '@/components/ui/FormField';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';

// activity 系セクションのフォーム振る舞いはセクション全体で 1 つの hasError を持ち、
// 最初の必須 input にだけ赤枠を付けて「ここを直して」を示す（個別 error 文言は出さない）。
// 既存 UX 維持のため Input には !border-red-400 を className で被せる。
// section 上部の error list は AlertBox(error) で統一。
const ERROR_INPUT_CLASS = '!border-red-400 focus:!ring-red-400';

// 長文入力用 Textarea の追加 className（resize-none + min-h-[80px] は inputStyles 由来の UX）。
const TEXTAREA_CLASS = 'resize-none min-h-[80px]';

type Props = {
  activities: VolunteerActivity[];
  errors?: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof Omit<VolunteerActivity, 'type' | 'period'>, value: string) => void;
};

export default function VolunteerActivitySection({ activities, errors, onAdd, onRemove, onUpdate }: Props) {
  const [isOpen, setIsOpen] = useState(activities.length > 0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const prevLen = useRef(activities.length);
  useEffect(() => {
    if (activities.length > prevLen.current) setEditingIndex(activities.length - 1);
    prevLen.current = activities.length;
  }, [activities.length]);

  function handleAdd() {
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
          aria-expanded={isOpen}
          aria-controls="volunteer-activity-section-content"
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-sm font-semibold text-gray-700">ボランティア</span>
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
        <Button variant="outline" size="sm" onClick={handleAdd} className="ml-3 shrink-0">
          ＋ 追加
        </Button>
      </div>

      {isOpen && (
        <div id="volunteer-activity-section-content" className="border-t border-gray-100 px-4 pt-3 pb-4">
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
              const hasError = errors?.some(e => e.startsWith(`ボランティア${index + 1}:`)) ?? false;
              return (
                <ActivityCard
                  key={index}
                  label={`ボランティア ${index + 1}`}
                  summary={activity.activityContent}
                  isEditing={editingIndex === index}
                  onEdit={() => setEditingIndex(index)}
                  onDone={() => setEditingIndex(null)}
                  onRemove={() => confirmRemove(index)}
                >
                  <FormField label="活動内容" required>
                    <Input
                      type="text"
                      value={activity.activityContent}
                      onChange={(e) => onUpdate(index, 'activityContent', e.target.value)}
                      placeholder="例：高齢者施設でのサポート"
                      className={hasError ? ERROR_INPUT_CLASS : ''}
                    />
                  </FormField>
                  <FormField label="対象">
                    <Input
                      type="text"
                      value={activity.target}
                      onChange={(e) => onUpdate(index, 'target', e.target.value)}
                      placeholder="例：高齢者、子ども"
                    />
                  </FormField>
                  <FormField
                    label="印象に残っていること"
                    hint="短くても大丈夫です。一言からでもOK。"
                  >
                    <Textarea
                      value={activity.description}
                      onChange={(e) => onUpdate(index, 'description', e.target.value)}
                      placeholder="活動を通じて印象に残っていることを書いてください"
                      className={TEXTAREA_CLASS}
                    />
                  </FormField>
                  <FormField label="うまくいったこと">
                    <Textarea
                      value={activity.achievement}
                      onChange={(e) => onUpdate(index, 'achievement', e.target.value)}
                      placeholder="うまくいったこと・成果など"
                      className={TEXTAREA_CLASS}
                    />
                  </FormField>
                  <FormField label="失敗・苦労したこと">
                    <Textarea
                      value={activity.challenge}
                      onChange={(e) => onUpdate(index, 'challenge', e.target.value)}
                      placeholder="困ったこと・苦労したことなど"
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
