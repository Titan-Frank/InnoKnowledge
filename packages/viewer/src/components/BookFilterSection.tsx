import { useGraphStore, setSelectedBook, setFocusConnected } from '../store/graphStore.js';

export function BookFilterSection() {
  const data = useGraphStore((s) => s.data);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const focusConnected = useGraphStore((s) => s.focusConnected);

  if (!data) return null;

  const books = ['all', ...data.booksById.keys()];

  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>来源范围</h2>
      </div>
      <div className="segmented">
        {books.map((bookId) => (
          <button
            key={bookId}
            className={`segment ${selectedBook === bookId ? 'active' : ''}`}
            onClick={() => setSelectedBook(bookId)}
          >
            {bookId === 'all' ? '全部来源' : bookId}
          </button>
        ))}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={focusConnected}
          onChange={(e) => setFocusConnected(e.target.checked)}
        />
        <span>只显示与当前选中节点直接相连的网络</span>
      </label>
    </section>
  );
}
