import type { CSSProperties } from 'react';
import { useGraphStore, setSearchTerm } from '../store/graphStore.js';
import { getSearchMatches } from '../graph/visibility.js';
import { aiWebComponentTokens } from './aiwc/index.js';

export function SearchSection() {
  const searchTerm = useGraphStore((s) => s.searchTerm);
  const data = useGraphStore((s) => s.data);

  const countText = data
    ? (() => {
        const allMatches = getSearchMatches(useGraphStore.getState());
        const matches = allMatches.slice(0, 60);
        return allMatches.length > matches.length
          ? `前 ${matches.length} / ${allMatches.length} 项`
          : `${allMatches.length} 项`;
      })()
    : '0 项';

  return (
    <div style={sectionStyle}>
      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>检索</h2>
        <span style={noteStyle}>{countText}</span>
      </div>
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>搜索节点</span>
        <input
          type="search"
          placeholder="输入知识点、物质、实验、方法..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={inputStyle}
        />
      </label>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  padding: '16px 16px 12px',
  borderTop: `1px solid ${aiWebComponentTokens.colorBorder}`,
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

const inputStyle: CSSProperties = {
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
