import { SourceSection } from './SourceSection.js';
import { SearchSection } from './SearchSection.js';
import { BookFilterSection } from './BookFilterSection.js';
import { LayerModeSection } from './LayerModeSection.js';
import { TypeFilterSection } from './TypeFilterSection.js';
import { SearchResultList } from './SearchResultList.js';
import { workspaceDockStyle, workspacePanelContentStyle } from './workspaceStyles.js';

export function Sidebar() {
  return (
    <aside style={workspaceDockStyle}>
      <div style={workspacePanelContentStyle}>
        <SourceSection />
        <SearchSection />
        <BookFilterSection />
        <LayerModeSection />
        <TypeFilterSection />
        <SearchResultList />
      </div>
    </aside>
  );
}
