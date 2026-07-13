const colors = {
  entity: "#65e6c4",
  concept: "#6ab7ff",
  property: "#d59cff",
  process: "#ffb86b",
  event: "#ff7d96",
  method: "#66d9a7",
  rule: "#ffd166",
  representation: "#8da4ff",
  resource: "#7ad7e8",
};

const state = {
  graph: null,
  index: null,
  selectedId: null,
  query: "",
  kind: "all",
};

const searchInput = document.querySelector("#search");
const listElement = document.querySelector("#object-list");
const filtersElement = document.querySelector("#kind-filters");
const graphElement = document.querySelector("#graph");
const detailElement = document.querySelector("#detail-panel");

searchInput.addEventListener("input", () => {
  state.query = searchInput.value.trim().toLowerCase();
  renderCatalog();
  updateGraphHighlight();
});

Promise.all([
  fetch("../data/graph.json").then(assertOk).then((response) => response.json()),
  fetch("../data/units/index.json").then(assertOk).then((response) => response.json()),
]).then(([graph, index]) => {
  state.graph = graph;
  state.index = index;
  document.querySelector("#dataset-label").textContent = `${graph.dataset.dataset_name} · ${graph.dataset.schema_version}`;
  document.querySelector("#counts").textContent = `${graph.counts.nodes} objects · ${graph.counts.edges} relations · ${graph.counts.evidence} evidence`;
  renderFilters();
  renderCatalog();
  renderGraph();
}).catch((error) => {
  detailElement.textContent = `Artifact loading failed: ${error.message}. Serve this directory through a local HTTP server.`;
});

function assertOk(response) {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response;
}

function visibleNodes() {
  if (!state.graph) return [];
  return state.graph.nodes.filter((node) => {
    const kind = node.kind ?? node.node_kind ?? "concept";
    const matchesKind = state.kind === "all" || kind === state.kind;
    const searchable = `${node.name ?? node.canonical_name ?? ""} ${kind} ${node.definition ?? ""}`.toLowerCase();
    return matchesKind && (!state.query || searchable.includes(state.query));
  });
}

function renderFilters() {
  const kinds = ["all", ...new Set(state.graph.nodes.map((node) => node.kind ?? node.node_kind ?? "concept"))];
  filtersElement.replaceChildren(...kinds.map((kind) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = kind;
    button.className = kind === state.kind ? "active" : "";
    button.addEventListener("click", () => {
      state.kind = kind;
      renderFilters();
      renderCatalog();
      updateGraphHighlight();
    });
    return button;
  }));
}

function renderCatalog() {
  const nodes = visibleNodes();
  listElement.replaceChildren(...nodes.map((node) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `object-item${node.id === state.selectedId ? " active" : ""}`;
    const name = document.createElement("strong");
    name.textContent = node.name ?? node.canonical_name ?? node.id;
    const meta = document.createElement("span");
    meta.textContent = `${node.kind ?? node.node_kind ?? "concept"} · ${node.id}`;
    button.append(name, meta);
    button.addEventListener("click", () => selectNode(node.id));
    return button;
  }));
  if (!nodes.length) {
    const message = document.createElement("p");
    message.textContent = "No matching knowledge objects.";
    message.className = "subtitle";
    listElement.append(message);
  }
}

function renderGraph() {
  const nodes = [...state.graph.nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const dense = nodes.length > 40;
  const position = new Map();
  const centerX = 460;
  const centerY = 310;
  const radiusX = 370;
  const radiusY = 250;
  nodes.forEach((node, index) => {
    const angle = dense
      ? index * 2.399963229728653
      : (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    const distance = dense ? Math.sqrt((index + 0.5) / nodes.length) : 1;
    position.set(node.id, {
      x: centerX + Math.cos(angle) * radiusX * distance,
      y: centerY + Math.sin(angle) * radiusY * distance,
    });
  });

  const namespace = "http://www.w3.org/2000/svg";
  graphElement.replaceChildren();
  graphElement.classList.toggle("dense", dense);
  const defs = document.createElementNS(namespace, "defs");
  const marker = document.createElementNS(namespace, "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "5");
  marker.setAttribute("markerHeight", "5");
  marker.setAttribute("orient", "auto-start-reverse");
  const arrow = document.createElementNS(namespace, "path");
  arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  arrow.setAttribute("fill", "rgba(118,165,189,0.55)");
  marker.append(arrow);
  defs.append(marker);
  graphElement.append(defs);

  for (const edge of state.graph.edges) {
    const from = position.get(edge.from_id ?? edge.from);
    const to = position.get(edge.to_id ?? edge.to);
    if (!from || !to) continue;
    const line = document.createElementNS(namespace, "line");
    line.classList.add("edge");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x);
    line.setAttribute("y2", to.y);
    if (edge.directionality === "directed") line.setAttribute("marker-end", "url(#arrow)");
    const title = document.createElementNS(namespace, "title");
    title.textContent = edge.type ?? edge.edge_type ?? "related_to";
    line.append(title);
    graphElement.append(line);
  }

  for (const node of nodes) {
    const point = position.get(node.id);
    const kind = node.kind ?? node.node_kind ?? "concept";
    const group = document.createElementNS(namespace, "g");
    group.classList.add("node");
    group.dataset.nodeId = node.id;
    group.setAttribute("transform", `translate(${point.x} ${point.y})`);
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    const circle = document.createElementNS(namespace, "circle");
    circle.setAttribute("r", dense ? "7" : "28");
    circle.setAttribute("fill", colors[kind] ?? colors.concept);
    const text = document.createElementNS(namespace, "text");
    text.setAttribute("y", "45");
    text.textContent = dense ? "" : truncate(node.name ?? node.canonical_name ?? node.id, 17);
    const title = document.createElementNS(namespace, "title");
    title.textContent = `${node.name ?? node.canonical_name ?? node.id} · ${kind}`;
    group.append(circle, text, title);
    group.addEventListener("click", () => selectNode(node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") selectNode(node.id);
    });
    graphElement.append(group);
  }
  updateGraphHighlight();
}

function updateGraphHighlight() {
  if (!state.graph) return;
  const visible = new Set(visibleNodes().map((node) => node.id));
  graphElement.querySelectorAll(".node").forEach((element) => {
    element.classList.toggle("dimmed", !visible.has(element.dataset.nodeId));
    element.classList.toggle("selected", element.dataset.nodeId === state.selectedId);
  });
}

async function selectNode(nodeId) {
  state.selectedId = nodeId;
  renderCatalog();
  updateGraphHighlight();
  const entry = state.index.units.find((item) => item.node_id === nodeId);
  if (!entry) throw new Error(`Unit index is missing '${nodeId}'.`);
  detailElement.textContent = "Loading ApiUnit…";
  const unit = await fetch(`../data/units/${entry.file}`).then(assertOk).then((response) => response.json());
  renderUnit(unit);
}

function renderUnit(unit) {
  const header = element("div", "detail-header");
  header.append(
    element("p", "eyebrow", "COMPLETE APIUNIT"),
    element("h2", "", unit.node.name),
    element("p", "subtitle", unit.node.definition),
  );
  const badges = element("div", "badge-row");
  badges.append(
    element("span", "badge", unit.node.kind),
    element("span", "badge", `${Math.round(unit.completeness.score)}% complete`),
    element("span", "badge", `${unit.evidence.length} evidence`),
  );
  header.append(badges);

  const relations = [...unit.relations.outgoing.map((edge) => `→ ${edge.type} · ${edge.to_id}`),
    ...unit.relations.incoming.map((edge) => `← ${edge.type} · ${edge.from_id}`)];
  const evidenceSection = section("Source evidence");
  if (unit.evidence.length) {
    unit.evidence.forEach((item) => {
      const card = element("div", "evidence-card");
      card.append(element("div", "evidence-id", item.id), element("p", "", item.excerpt || "No text excerpt."));
      evidenceSection.append(card);
    });
  } else evidenceSection.append(element("p", "", "No evidence records."));

  const completeness = section("Completeness signals");
  completeness.append(list(unit.completeness.signals.map((signal) => `${signal.passed ? "✓" : "○"} ${signal.label}: ${signal.message}`)));

  detailElement.replaceChildren(
    header,
    textSection("Relations", relations),
    textSection("Knowledge card", unit.card ? [unit.card.summary || JSON.stringify(unit.card.sections)] : []),
    textSection("Knowledge body", unit.body ? [unit.body.content] : []),
    evidenceSection,
    completeness,
  );
}

function textSection(title, items) {
  const container = section(title);
  container.append(items.length ? list(items) : element("p", "", "No records."));
  return container;
}

function section(title) {
  const container = element("section", "detail-section");
  container.append(element("h3", "", title));
  return container;
}

function list(items) {
  const container = document.createElement("ul");
  items.forEach((item) => container.append(element("li", "", String(item))));
  return container;
}

function element(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = String(text);
  return item;
}

function truncate(value, length) {
  const text = String(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
