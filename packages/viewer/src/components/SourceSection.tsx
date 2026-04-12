import type { CSSProperties } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { useSwitchSource } from '../hooks/useBootData.js';
import { aiWebComponentTokens } from './aiwc/index.js';

export function SourceSection() {
  const sourceConfigs = useGraphStore((s) => s.sourceConfigs);
  const selectedSourceKey = useGraphStore((s) => s.selectedSourceKey);
  const sourceLoading = useGraphStore((s) => s.sourceLoading);
  const data = useGraphStore((s) => s.data);
  const switchSource = useSwitchSource();

  const sources = Array.from(sourceConfigs.values());
  const source = sourceConfigs.get(selectedSourceKey || '') || sources[0];
  const warnings = data?.loadWarnings || [];
  const sourceNote = sourceLoading ? '切换中' : source?.label;

  const info: string[] = [];
  if (source?.description) info.push(source.description);
  if (source?.hasProfiles) info.push('含 profiles');
  if (warnings.length > 0) info.push(`警告：${warnings[0]}`);

  return (
    <div style={sectionStyle}>
      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>数据源</h2>
        <span style={noteStyle}>{sourceNote}</span>
      </div>
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>选择版本</span>
        <select
          value={selectedSourceKey || ''}
          disabled={sourceLoading}
          onChange={(e) => switchSource(e.target.value)}
          style={selectStyle}
        >
          {sources.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </label>
      <p style={hintStyle}>{info.join(' | ')}</p>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  padding: '16px 16px 12px',
};

const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 12,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.06rem',
  fontWeight: 600,
};

const noteStyle: CSSProperties = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.82rem',
};

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const fieldLabelStyle: CSSProperties = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.9rem',
};

const selectStyle: CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 14px',
  border: `1px solid ${aiWebComponentTokens.colorBorderStrong}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurface,
  color: aiWebComponentTokens.colorText,
  fontSize: '0.96rem',
  fontFamily: 'inherit',
};

const hintStyle: CSSProperties = {
  margin: '8px 0 0',
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.84rem',
  lineHeight: 1.6,
};
