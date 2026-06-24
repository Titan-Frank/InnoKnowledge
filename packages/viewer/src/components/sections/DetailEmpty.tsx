import { Network } from '@/lib/lucide-icons';

export function DetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Network className="h-8 w-8 text-text-muted" />
      <div>
        <div className="text-sm font-medium text-text-secondary">选择一个节点</div>
        <div className="text-xs text-text-muted mt-1">点击图谱中的节点查看详细信息</div>
      </div>
    </div>
  );
}
