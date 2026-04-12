import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import {
  SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS, MASTERY_LEVEL_LABELS,
} from '../constants/index.js';
import { humanizeKey } from '../graph/layout.js';
import { ToneBadge, aiWebComponentTokens } from './aiwc/index.js';

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
      <div style={blockStyle}>
        <h3 style={blockTitleStyle}>课程画像</h3>
        <div style={emptyStyle}>
          <p style={emptyTextStyle}>当前数据源里还没有这个节点的课程画像。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>课程画像</h3>
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
            <div style={itemStyle} key={profile.id}>
              <h4 style={itemTitleStyle}>{header}</h4>
              <div style={chipsStyle}>
                {chips.map((chip) => (
                  <ToneBadge key={chip} tone="neutral">{chip}</ToneBadge>
                ))}
              </div>
              {profile.learning_objectives?.length > 0 ? (
                <ul style={objListStyle}>
                  {profile.learning_objectives.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p style={emptyTextStyle}>暂无学习目标描述。</p>
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

const blockStyle: CSSProperties = {
  marginTop: 16,
};

const blockTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.06rem',
  fontWeight: 600,
};

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 8,
};

const itemStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurface,
  padding: 12,
};

const itemTitleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const chipsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
};

const objListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: aiWebComponentTokens.colorMuted,
  lineHeight: 1.65,
};

const emptyStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurfaceMuted,
  padding: 12,
  marginTop: 8,
};

const emptyTextStyle: CSSProperties = {
  margin: 0,
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  lineHeight: 1.6,
};
