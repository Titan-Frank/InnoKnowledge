import { SourceSection } from './SourceSection.js';
import { SearchSection } from './SearchSection.js';
import { BookFilterSection } from './BookFilterSection.js';
import { LayerModeSection } from './LayerModeSection.js';
import { TypeFilterSection } from './TypeFilterSection.js';
import { SearchResultList } from './SearchResultList.js';

export function Sidebar() {
  return (
    <aside className="sidebar panel fade-in">
      <SourceSection />
      <SearchSection />
      <BookFilterSection />
      <LayerModeSection />
      <TypeFilterSection />
      <SearchResultList />
    </aside>
  );
}
