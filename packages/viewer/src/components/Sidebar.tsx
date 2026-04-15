import { SourceSection } from './SourceSection.js';
import { SearchSection } from './SearchSection.js';
import { BookFilterSection } from './BookFilterSection.js';
import { LayerModeSection } from './LayerModeSection.js';
import { TypeFilterSection } from './TypeFilterSection.js';
import { SearchResultList } from './SearchResultList.js';
import { createWorkspaceDockStyle, workspacePanelContentStyle } from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

export function Sidebar() {
  const t = useTokens();
  return (
    <aside style={createWorkspaceDockStyle(t)}>
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
