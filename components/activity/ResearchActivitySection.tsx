import { useState, useRef, useEffect } from 'react';
import type { ResearchActivity } from '@/types/activity';
import { ActivityCard } from './ActivityCard';
import { ActivitySectionShell } from './ActivitySectionShell';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FormField } from '@/components/ui/FormField';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';

const ERROR_INPUT_CLASS = '!border-red-400 focus:!ring-red-400';
const TEXTAREA_CLASS = 'resize-none min-h-[80px]';

type Props = {
  activities: ResearchActivity[];
  errors?: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof Omit<ResearchActivity, 'type' | 'period'>, value: string) => void;
};

export default function ResearchActivitySection({ activities, errors, onAdd, onRemove, onUpdate }: Props) {
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
    <ActivitySectionShell
      title="探究活動"
      count={activities.length}
      hasError={!!(errors && errors.length > 0)}
      isOpen={isOpen}
      onToggle={() => setIsOpen((v) => !v)}
      contentId="research-activity-section-content"
      rightSlot={
        <Button variant="outline" size="sm" onClick={handleAdd} className="ml-3 shrink-0">
          ＋ 追加
        </Button>
      }
    >
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
          const hasError = errors?.some(e => e.startsWith(`探究${index + 1}:`)) ?? false;
          return (
            <ActivityCard
              key={index}
              label={`探究 ${index + 1}`}
              summary={activity.theme}
              isEditing={editingIndex === index}
              onEdit={() => setEditingIndex(index)}
              onDone={() => setEditingIndex(null)}
              onRemove={() => confirmRemove(index)}
            >
              <FormField label="テーマ" required>
                <Input
                  type="text"
                  value={activity.theme}
                  onChange={(e) => onUpdate(index, 'theme', e.target.value)}
                  placeholder="例：地域の環境問題"
                  className={hasError ? ERROR_INPUT_CLASS : ''}
                />
              </FormField>
              <FormField label="きっかけ">
                <Input
                  type="text"
                  value={activity.trigger}
                  onChange={(e) => onUpdate(index, 'trigger', e.target.value)}
                  placeholder="このテーマを選んだきっかけ"
                />
              </FormField>
              <FormField label="調査方法">
                <Input
                  type="text"
                  value={activity.methodology}
                  onChange={(e) => onUpdate(index, 'methodology', e.target.value)}
                  placeholder="例：アンケート、フィールドワーク"
                />
              </FormField>
              <FormField
                label="印象に残っていること"
                hint="短くても大丈夫です。一言からでもOK。"
              >
                <Textarea
                  value={activity.description}
                  onChange={(e) => onUpdate(index, 'description', e.target.value)}
                  placeholder="探究を通じて印象に残っていることを書いてください"
                  className={TEXTAREA_CLASS}
                />
              </FormField>
              <FormField label="うまくいったこと">
                <Textarea
                  value={activity.achievement}
                  onChange={(e) => onUpdate(index, 'achievement', e.target.value)}
                  placeholder="うまくいったこと・わかったことなど"
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
    </ActivitySectionShell>
  );
}
