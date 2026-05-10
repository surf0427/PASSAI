import { AlertBox } from '@/components/ui/AlertBox';

export default function ActivityFormHint() {
  return (
    <AlertBox variant="info" className="mb-8 space-y-1">
      <p>完璧に書かなくて大丈夫です。</p>
      <p>短くてもいいので、できるだけ具体的に書いてください。</p>
      <p>後でAIが整理します。</p>
    </AlertBox>
  );
}
