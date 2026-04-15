import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import {
  SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS, MASTERY_LEVEL_LABELS,
} from '../constants/index.js';
import { humanizeKey } from '../graph/layout.js';
import { ToneBadge } from './aiwc/index.js';
import {
  createDetailBodyTextStyle,
  createDetailEmptyCardStyle,
  createDetailSectionMetaStyle,
  createDetailSectionStyle,
  createDetailSectionTitleStyle,
  createDetailSubcardStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

interface Props {
  node: GraphNode;
}

export function DetailProfiles({ node }: Props) {
  const t = useTokens();
  const profiles = (node.profiles || []).slice().sort((a, b) => {
    const subjectCompare = String(a.subject || '').localeCompare(String(b.subject || ''), 'zh-CN');
    if (subjectCompare !== 0) return subjectCompare;
    return String(a.grade_band || '').localeCompare(String(b.grade_band || ''), 'zh-CN');
  });

  if (profiles.length === 0) {
    return (
      <div style={createDetailSectionStyle(t)}>
        <div style={headStyle}>
          <h3 style={createDetailSectionTitleStyle(t)}>课程画像</h3>
          <span style={createDetailSectionMetaStyle(t)}>0 条</span>
        </div>
        <div style={createDetailEmptyCardStyle(t)}>
          <p style={createDetailBodyTextStyle(t)}>当前数据源里还没有这个节点的课程画像。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={createDetailSectionStyle(t)}>
      <div style={headStyle}>
        <h3 style={createDetailSectionTitleStyle(t)}>课程画像</h3>
        <span style={createDetailSectionMetaStyle(t)}>{profiles.length} 条</span>
      </div>
      <div style={listStyle}>
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
            <div style={createDetailSubcardStyle(t)} key={profile.id}>
              <h4 style={itemTitleStyle}>{header}</h4>
              <div style={chipsStyle}>
                {chips.map((chip) => (
                  <ToneBadge key={chip} tone="neutral">{chip}</ToneBadge>
                ))}
              </div>
              {profile.learning_objectives?.length > 0 ? (
                <ul style={objListStyle(t)}>
                  {profile.learning_objectives.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p style={createDetailBodyTextStyle(t)}>暂无学习目标描述。</p>
              )}
              {assessmentSignals.length > 0 && (
                <div style={chipsStyle}>
                  {assessmentSignals.map((item) => (
                    <ToneBadge key={item} tone="neutral">{item}</ToneBadge>
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

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const itemTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const chipsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

function objListStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    margin: 0,
    paddingLeft: 18,
    color: t.colorMuted,
    lineHeight: 1.65,
  };
}
