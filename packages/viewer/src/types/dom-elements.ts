export interface DomElements {
  canvasWrap: HTMLDivElement;
  canvas: HTMLCanvasElement;
  statsGrid: HTMLDivElement;
  typeFilter: HTMLDivElement;
  bookFilter: HTMLDivElement;
  sourceSelect: HTMLSelectElement;
  sourceNote: HTMLSpanElement;
  sourceHint: HTMLParagraphElement;
  layerMode: HTMLDivElement;
  layerNote: HTMLSpanElement;
  layerHint: HTMLParagraphElement;
  collapseSupport: HTMLButtonElement;
  searchInput: HTMLInputElement;
  searchResults: HTMLDivElement;
  searchCount: HTMLSpanElement;
  legend: HTMLDivElement;
  fitView: HTMLButtonElement;
  toggleLabels: HTMLButtonElement;
  resetTypes: HTMLButtonElement;
  focusConnected: HTMLInputElement;
  detailEmpty: HTMLElement;
  detailContent: HTMLElement;
  detailType: HTMLParagraphElement;
  detailTitle: HTMLHeadingElement;
  detailBadges: HTMLDivElement;
  detailDescription: HTMLParagraphElement;
  detailAxis: HTMLDivElement;
  detailProfiles: HTMLDivElement;
  detailAliases: HTMLDivElement;
  detailProperties: HTMLDivElement;
  detailSupport: HTMLDivElement;
  detailSupportNote: HTMLSpanElement;
  detailCard: HTMLDivElement;
  cardStatus: HTMLSpanElement;
  detailRelations: HTMLDivElement;
  detailMentions: HTMLDivElement;
  detailEvidence: HTMLDivElement;
}

export function getDomElements(): DomElements {
  const getById = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T;

  return {
    canvasWrap: getById('canvas-wrap'),
    canvas: getById('graph-canvas'),
    statsGrid: getById('stats-grid'),
    typeFilter: getById('type-filter'),
    bookFilter: getById('book-filter'),
    sourceSelect: getById('source-select'),
    sourceNote: getById('source-note'),
    sourceHint: getById('source-hint'),
    layerMode: getById('layer-mode'),
    layerNote: getById('layer-note'),
    layerHint: getById('layer-hint'),
    collapseSupport: getById('collapse-support'),
    searchInput: getById('search-input'),
    searchResults: getById('search-results'),
    searchCount: getById('search-count'),
    legend: getById('legend'),
    fitView: getById('fit-view'),
    toggleLabels: getById('toggle-labels'),
    resetTypes: getById('reset-types'),
    focusConnected: getById('focus-connected'),
    detailEmpty: getById('detail-empty'),
    detailContent: getById('detail-content'),
    detailType: getById('detail-type'),
    detailTitle: getById('detail-title'),
    detailBadges: getById('detail-badges'),
    detailDescription: getById('detail-description'),
    detailAxis: getById('detail-axis'),
    detailProfiles: getById('detail-profiles'),
    detailAliases: getById('detail-aliases'),
    detailProperties: getById('detail-properties'),
    detailSupport: getById('detail-support'),
    detailSupportNote: getById('detail-support-note'),
    detailCard: getById('detail-card'),
    cardStatus: getById('card-status'),
    detailRelations: getById('detail-relations'),
    detailMentions: getById('detail-mentions'),
    detailEvidence: getById('detail-evidence'),
  };
}
