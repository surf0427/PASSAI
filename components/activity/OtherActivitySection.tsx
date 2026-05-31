import { useState, useRef, useEffect } from 'react';
import type { OtherActivity } from '@/types/activity';
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
  activities: OtherActivity[];
  errors?: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof Omit<OtherActivity, 'type' | 'period'>, value: string) => void;
  onUpdatePeriod: (index: number, field: 'from' | 'to', value: string) => void;
};

export default function OtherActivitySection({ activities, errors, onAdd, onRemove, onUpdate, onUpdatePeriod }: Props) {
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
      title="その他"
      count={activities.length}
      hasError={!!(errors && errors.length > 0)}
      isOpen={isOpen}
      onToggle={() => setIsOpen((v) => !v)}
      contentId="other-activity-section-content"
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
        <p className="text-sm text-gray-400 py-2">
          ＋追加ボタンで入力欄を追加できます（例：個人開発、SNS運営、家業手伝い、地域活動 など）
        </p>
      )}
      <div className="space-y-4">
        {activities.map((activity, index) => {
          const hasError = errors?.some(e => e.startsWith(`その他${index + 1}:`)) ?? false;
          return (
            <ActivityCard
              key={index}
              label={`その他 ${index + 1}`}
              summary={activity.activityName}
              isEditing={editingIndex === index}
              onEdit={() => setEditingIndex(index)}
              onDone={() => setEditingIndex(null)}
              onRemove={() => confirmRemove(index)}
            >
              <FormField label="活動名" required>
                <Input
                  type="text"
                  value={activity.activityName}
                  onChange={(e) => onUpdate(index, 'activityName', e.target.value)}
                  placeholder="例：個人開発、SNS運営、家業手伝い"
                  className={hasError ? ERROR_INPUT_CLASS : ''}
                />
              </FormField>
              <div className="space-y-2">
                <p className="block text-sm font-semibold text-slate-800">期間</p>
                <div className="flex gap-2 items-center">
                  <Input
                    type="text"
                    value={activity.period.from}
                    onChange={(e) => onUpdatePeriod(index, 'from', e.target.value)}
                    placeholder="例：2023年4月"
                  />
                  <span className="text-gray-400 shrink-0">〜</span>
                  <Input
                    type="text"
                    value={activity.period.to}
                    onChange={(e) => onUpdatePeriod(index, 'to', e.target.value)}
                    placeholder="例：現在"
                  />
                </div>
              </div>
              <FormField
                label="活動内容"
                hint="短くても大丈夫です。一言からでもOK。"
              >
                <Textarea
                  value={activity.description}
                  onChange={(e) => onUpdate(index, 'description', e.target.value)}
                  placeholder="活動内容や印象に残っていることを書いてください"
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
    </ActivitySectionShell>
  );
}
