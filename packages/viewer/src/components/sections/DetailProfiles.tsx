import type { OKMNode } from '@/core/graph/types';
import { SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS, MASTERY_LEVEL_LABELS } from '@/lib/constants';

export function DetailProfiles({ node }: { node: OKMNode }) {
  if (!node.profiles || node.profiles.length === 0) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">课程画像 ({node.profiles.length})</div>
      <div className="space-y-2">
        {node.profiles.map((profile, i) => (
          <div key={i} className="rounded-lg border border-border-subtle bg-elevated p-2.5">
            {profile.subject && (
              <div className="text-xs font-medium text-text-primary">{String(profile.subject)}</div>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {profile.school_stage && (
                <span className="rounded bg-surface px-1 py-0.5 text-[10px] text-text-muted">
                  {SCHOOL_STAGE_LABELS[String(profile.school_stage)] ?? String(profile.school_stage)}
                </span>
              )}
              {profile.curriculum_role && (
                <span className="rounded bg-surface px-1 py-0.5 text-[10px] text-text-muted">
                  {CURRICULUM_ROLE_LABELS[String(profile.curriculum_role)] ?? String(profile.curriculum_role)}
                </span>
              )}
              {profile.mastery_level && (
                <span className="rounded bg-surface px-1 py-0.5 text-[10px] text-text-muted">
                  {MASTERY_LEVEL_LABELS[String(profile.mastery_level)] ?? String(profile.mastery_level)}
                </span>
              )}
            </div>
            {profile.objectives != null && (
              <div className="mt-1 text-[11px] text-text-muted line-clamp-2">
                {String(profile.objectives)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
