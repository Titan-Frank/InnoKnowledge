import { useGraphStore, setSelectedBook, setFocusConnected } from '../store/graphStore.js';
import { SegmentedControl } from './aiwc/index.js';
import {
  workspaceSectionHeaderStyle,
  workspaceSectionStyle,
  workspaceSectionTitleStyle,
  workspaceToggleStyle,
} from './workspaceStyles.js';

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
    <div style={workspaceSectionStyle}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={workspaceSectionTitleStyle}>来源范围</h2>
      </div>
      <SegmentedControl
        value={selectedBook}
        items={items}
        onChange={setSelectedBook}
        ariaLabel="来源范围"
      />
      <label style={workspaceToggleStyle}>
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
