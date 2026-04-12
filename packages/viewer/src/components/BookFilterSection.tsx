import type { CSSProperties } from 'react';
import { useGraphStore, setSelectedBook, setFocusConnected } from '../store/graphStore.js';
import { SegmentedControl } from './aiwc/index.js';
import { aiWebComponentTokens } from './aiwc/index.js';

export function BookFilterSection() {
  const data = useGraphStore((s) => s.data);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const focusConnected = useGraphStore((s) => s.focusConnected);

  if (!data) return null;

  const books = ['all', ...data.booksById.keys()];
  const items = books.map((bookId) => ({
    id: bookId,
    label: bookId === 'all' ? '全部来源' : bookId,
  }));

  return (
    <div style={sectionStyle}>
      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>来源范围</h2>
      </div>
      <SegmentedControl
        value={selectedBook}
        items={items}
        onChange={setSelectedBook}
        ariaLabel="来源范围"
      />
      <label style={toggleStyle}>
        <input
          type="checkbox"
          checked={focusConnected}
          onChange={(e) => setFocusConnected(e.target.checked)}
        />
        <span>只显示与当前选中节点直接相连的网络</span>
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

const toggleStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  marginTop: 12,
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
};
