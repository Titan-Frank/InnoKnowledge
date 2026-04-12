import type { CSSProperties } from 'react';
import { SourceSection } from './SourceSection.js';
import { SearchSection } from './SearchSection.js';
import { BookFilterSection } from './BookFilterSection.js';
import { LayerModeSection } from './LayerModeSection.js';
import { TypeFilterSection } from './TypeFilterSection.js';
import { SearchResultList } from './SearchResultList.js';
import { aiWebComponentTokens } from './aiwc/index.js';

export function Sidebar() {
  return (
    <aside style={sidebarStyle}>
      <SourceSection />
      <SearchSection />
      <BookFilterSection />
      <LayerModeSection />
      <TypeFilterSection />
      <SearchResultList />
    </aside>
  );
}

const sidebarStyle: CSSProperties = {
  position: 'sticky',
  top: 20,
  maxHeight: 'calc(100vh - 52px)',
  overflow: 'auto',
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radius,
  background: aiWebComponentTokens.colorSurface,
  boxShadow: aiWebComponentTokens.shadow,
};
