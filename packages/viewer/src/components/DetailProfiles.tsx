import type { GraphNode } from '../store/types.js';
import {
  SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS, MASTERY_LEVEL_LABELS,
} from '../constants/index.js';
import { humanizeKey } from '../graph/layout.js';

interface Props {
  node: GraphNode;
}

export function DetailProfiles({ node }: Props) {
  const profiles = (node.profiles || []).slice().sort((a, b) => {
    const subjectCompare = String(a.subject || '').localeCompare(String(b.subject || ''), 'zh-CN');
    if (subjectCompare !== 0) return subjectCompare;
    return String(a.grade_band || '').localeCompare(String(b.grade_band || ''), 'zh-CN');
  });

  if (profiles.length === 0) {
    return (
      <div className="detail-block">
        <h3>课程画像</h3>
        <div className="profile-list">
          <div className="empty-state">
            <p>当前数据源里还没有这个节点的课程画像。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-block">
      <h3>课程画像</h3>
      <div className="profile-list">
        {profiles.map((profile) => {
          const header = [
            profile.subject || '未标注学科',
            SCHOOL_STAGE_LABELS[profile.school_stage] ?? humanizeKey(profile.school_stage),
            profile.grade_band ? `${profile.grade_band} 年级/学段` : null,
          ].filter(Boolean).join(' · ');

          const chips = [
            profile.id,
            CURRICULUM_ROLE_LABELS[profile.curriculum_role] ?? humanizeKey(profile.curriculum_role),
            MASTERY_LEVEL_LABELS[profile.mastery_level] ?? humanizeKey(profile.mastery_level),
            ...(profile.framework_refs || []).slice(0, 2),
          ].filter(Boolean);

          const assessmentSignals =
            (profile as Record<string, unknown>).assessment_signals &&
            Array.isArray((profile as Record<string, unknown>).assessment_signals) &&
            ((profile as Record<string, unknown>).assessment_signals as string[]).length > 0
              ? (profile as Record<string, unknown>).assessment_signals as string[]
              : [];

          return (
            <div className="profile-item" key={profile.id}>
              <h4>{header}</h4>
              <div className="micro-list">
                {chips.map((chip) => (
                  <span className="micro-chip" key={chip}>{chip}</span>
                ))}
              </div>
              {profile.learning_objectives?.length > 0 ? (
                <ul className="card-list">
                  {profile.learning_objectives.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>暂无学习目标描述。</p>
              )}
              {assessmentSignals.length > 0 && (
                <div className="micro-list">
                  {assessmentSignals.map((item) => (
                    <span className="micro-chip" key={item}>{item}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
