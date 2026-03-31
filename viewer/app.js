const TYPE_META = {
  concept: { label: "概念", color: "#9e4f2b" },
  substance: { label: "物质", color: "#2d6b7d" },
  entity: { label: "实体", color: "#2d6b7d" },
  experiment: { label: "实验", color: "#4f7a3f" },
  activity: { label: "活动", color: "#4f7a3f" },
  process: { label: "过程", color: "#6b7a3d" },
  principle: { label: "原理", color: "#8f5b2b" },
  method: { label: "方法", color: "#9c7b2f" },
  skill: { label: "技能", color: "#6d4d94" },
  symbol: { label: "符号", color: "#31576c" },
  representation: { label: "表征", color: "#31576c" },
  question: { label: "问题", color: "#a34b5f" },
  event: { label: "事件", color: "#9a4d63" },
  issue: { label: "议题", color: "#b15a3c" },
  other: { label: "其他", color: "#777777" },
};

const LEARNING_MODE_LABELS = {
  factual: "事实性",
  conceptual: "概念性",
  procedural: "程序性",
  metacognitive: "元认知",
};

const BRIDGE_TAG_LABELS = {
  system: "系统",
  structure: "结构",
  function: "功能",
  change: "变化",
  interaction: "相互作用",
  energy: "能量",
  matter: "物质",
  evidence: "证据",
  model: "模型",
  representation: "表征",
  measurement: "测量",
  classification: "分类",
  rule: "规则",
  scale: "尺度",
  causality: "因果",
  uncertainty: "不确定性",
};

const SCHOOL_STAGE_LABELS = {
  primary: "小学",
  junior_secondary: "初中",
  senior_secondary: "高中",
  higher: "高等教育",
  cross_stage: "跨学段",
};

const CURRICULUM_ROLE_LABELS = {
  introduced: "首次引入",
  reinforced: "巩固强化",
  developed: "深入发展",
  integrated: "综合整合",
  transferred: "迁移应用",
  assessed: "评价考查",
};

const MASTERY_LEVEL_LABELS = {
  aware: "感知",
  identify: "识别",
  understand: "理解",
  apply: "应用",
  analyze: "分析",
  model: "建模",
  transfer: "迁移",
  evaluate: "评价",
  create: "创造",
};

const NODE_LAYER_LABELS = {
  backbone: "主干",
  support: "支撑",
};

const EDGE_LAYER_LABELS = {
  backbone: "主干关系",
  support: "支撑关系",
};

const LAYER_MODE_OPTIONS = [
  {
    id: "backbone-expand",
    label: "主干展开",
    description: "默认只显示主干，选中主干节点时展开它的支撑节点。",
  },
  {
    id: "all",
    label: "全部节点",
    description: "同时显示主干和支撑节点。",
  },
];

const API_BASE = "/api";
const META_PATH = `${API_BASE}/meta`;
const SOURCE_QUERY_KEY = "source";
const DEFAULT_SOURCE_KEY = "default";
const DEFAULT_BOOK_INDEX = [];
const EMPTY_FRAMEWORK = { domains: [] };
const EMPTY_PATTERNS = { patterns: [] };

const state = {
  manifest: null,
  sourceConfigs: new Map(),
  selectedSourceKey: null,
  sourceLoading: false,
  sourceRequestId: 0,
  data: null,
  selectedNodeId: null,
  hoverNodeId: null,
  searchTerm: "",
  selectedBook: "all",
  selectedTypes: new Set(),
  focusConnected: false,
  layerMode: "backbone-expand",
  expandedBackboneNodeId: null,
  showLabels: true,
  transform: { x: 0, y: 0, scale: 1 },
  dragNodeId: null,
  panning: false,
  lastPointer: null,
  raf: null,
  cardCache: new Map(),
  detailRequestId: 0,
};

const els = {
  canvasWrap: document.getElementById("canvas-wrap"),
  canvas: document.getElementById("graph-canvas"),
  statsGrid: document.getElementById("stats-grid"),
  typeFilter: document.getElementById("type-filter"),
  bookFilter: document.getElementById("book-filter"),
  sourceSelect: document.getElementById("source-select"),
  sourceNote: document.getElementById("source-note"),
  sourceHint: document.getElementById("source-hint"),
  layerMode: document.getElementById("layer-mode"),
  layerNote: document.getElementById("layer-note"),
  layerHint: document.getElementById("layer-hint"),
  collapseSupport: document.getElementById("collapse-support"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  searchCount: document.getElementById("search-count"),
  legend: document.getElementById("legend"),
  fitView: document.getElementById("fit-view"),
  toggleLabels: document.getElementById("toggle-labels"),
  resetTypes: document.getElementById("reset-types"),
  focusConnected: document.getElementById("focus-connected"),
  detailEmpty: document.getElementById("detail-empty"),
  detailContent: document.getElementById("detail-content"),
  detailType: document.getElementById("detail-type"),
  detailTitle: document.getElementById("detail-title"),
  detailBadges: document.getElementById("detail-badges"),
  detailDescription: document.getElementById("detail-description"),
  detailAxis: document.getElementById("detail-axis"),
  detailProfiles: document.getElementById("detail-profiles"),
  detailAliases: document.getElementById("detail-aliases"),
  detailProperties: document.getElementById("detail-properties"),
  detailSupport: document.getElementById("detail-support"),
  detailSupportNote: document.getElementById("detail-support-note"),
  detailCard: document.getElementById("detail-card"),
  cardStatus: document.getElementById("card-status"),
  detailRelations: document.getElementById("detail-relations"),
  detailMentions: document.getElementById("detail-mentions"),
  detailEvidence: document.getElementById("detail-evidence"),
};

const ctx = els.canvas.getContext("2d");

boot().catch((error) => {
  console.error(error);
  const detail = escapeHtml(error?.message || "未知错误");
  els.detailEmpty.innerHTML = `
    <p class="eyebrow">Load Error</p>
    <h2>数据加载失败</h2>
    <p>${detail}</p>
    <p>请确认本地 SQLite API 服务已经启动，并检查数据库里是否已有可用 dataset。</p>
  `;
});

async function boot() {
  const meta = await fetchJson(META_PATH);
  state.manifest = meta?.manifest || {};
  state.sourceConfigs = resolveApiSourceConfigs(meta);
  state.selectedSourceKey = resolveInitialSourceKey(
    { default_source: meta?.active_source || meta?.default_source },
    state.sourceConfigs,
  );
  bindEvents();
  renderSourceControl();
  await switchSource(state.selectedSourceKey);
  startSimulation();
}

function resolveApiSourceConfigs(meta) {
  const configs = new Map();
  const sources = Array.isArray(meta?.sources) ? meta.sources : [];
  sources.forEach((source) => {
    const key = source?.key;
    if (!key) {
      return;
    }
    configs.set(key, {
      key,
      label: source.label || key.toUpperCase(),
      description: source.description || "",
      books: mergeBookSeeds(source.books, DEFAULT_BOOK_INDEX),
      hasProfiles: Boolean(source.has_profiles ?? source.hasProfiles),
      autoDiscovered: false,
      bundlePath: `${API_BASE}/source/${encodeURIComponent(key)}/bundle`,
      nodeCardPath: `${API_BASE}/source/${encodeURIComponent(key)}/node-card`,
    });
  });

  if (configs.size === 0) {
    throw new Error("SQLite API 没有返回任何可用数据集。");
  }

  return new Map(
    Array.from(configs.entries()).sort(([leftKey], [rightKey]) =>
      compareSourceKeys(leftKey, rightKey),
    ),
  );
}

function resolveSourceConfigs(manifest, discoveredSources = []) {
  const configs = new Map();
  const discoveredByKey = new Map(discoveredSources.map((config) => [config.key, config]));
  const rawSources = manifest?.sources;

  discoveredSources.forEach((config) => {
    configs.set(config.key, normalizeSourceConfig(config.key, config, manifest));
  });

  if (Array.isArray(rawSources)) {
    rawSources.forEach((config) => {
      const key = config?.key || config?.id;
      if (key) {
        configs.set(
          key,
          normalizeSourceConfig(
            key,
            { ...(discoveredByKey.get(key) || {}), ...(config || {}) },
            manifest,
          ),
        );
      }
    });
  } else if (rawSources && typeof rawSources === "object") {
    Object.entries(rawSources).forEach(([key, config]) => {
      configs.set(
        key,
        normalizeSourceConfig(
          key,
          { ...(discoveredByKey.get(key) || {}), ...(config || {}) },
          manifest,
        ),
      );
    });
  }

  if (configs.size === 0) {
    configs.set(DEFAULT_SOURCE_KEY, normalizeSourceConfig(DEFAULT_SOURCE_KEY, {}, manifest));
  }

  if (!configs.has(DEFAULT_SOURCE_KEY)) {
    configs.set(DEFAULT_SOURCE_KEY, normalizeSourceConfig(DEFAULT_SOURCE_KEY, {}, manifest));
  }

  return new Map(
    Array.from(configs.entries()).sort(([leftKey], [rightKey]) =>
      compareSourceKeys(leftKey, rightKey),
    ),
  );
}

function normalizeSourceConfig(key, config, manifest) {
  const defaults = getDefaultSourceDefinition(key);
  const seedBooks = mergeBookSeeds(
    config?.books,
    config?.discoveredBooks,
    manifest?.books,
    DEFAULT_BOOK_INDEX,
  );

  return {
    key,
    label: config.label || config.display_name || config.title || defaults.label,
    description: config.description || defaults.description || "",
    nodesPath: config.nodes_path || config.nodesPath || defaults.nodesPath,
    edgesPath: config.edges_path || config.edgesPath || defaults.edgesPath,
    profilesPath: config.profiles_path || config.profilesPath || defaults.profilesPath,
    frameworkPath: config.framework_path || config.frameworkPath || defaults.frameworkPath,
    patternsPath: config.patterns_path || config.patternsPath || defaults.patternsPath,
    nodeCardsDir: config.node_cards_dir || config.nodeCardsDir || defaults.nodeCardsDir,
    books: resolveBookIndex(seedBooks, key),
    autoDiscovered: Boolean(config.autoDiscovered),
  };
}

function getDefaultSourceDefinition(key) {
  if (key === "v1") {
    return {
      label: "V1 Legacy",
      description: "读取旧版 data/graph + data/node_cards 输出",
      nodesPath: "../data/graph/knowledge.nodes.jsonl",
      edgesPath: "../data/graph/knowledge.edges.jsonl",
      profilesPath: null,
      frameworkPath: "../data/frameworks/junior-chemistry-framework.json",
      patternsPath: "../data/patterns/junior-chemistry-patterns.json",
      nodeCardsDir: "../data/node_cards",
    };
  }

  if (key === "v2") {
    return {
      label: "V2 Unified",
      description: "读取统一知识地图 V2 输出",
      nodesPath: "../data/v2/graph/knowledge.nodes.jsonl",
      edgesPath: "../data/v2/graph/knowledge.edges.jsonl",
      profilesPath: "../data/v2/profiles/knowledge.profiles.jsonl",
      frameworkPath: "../data/frameworks/junior-chemistry-framework.json",
      patternsPath: "../data/patterns/unified-knowledge-patterns.v2.json",
      nodeCardsDir: "../data/v2/node_cards",
    };
  }

  return {
    label: key.toUpperCase(),
    description: `读取 data/${key}/ 下的版本输出`,
    nodesPath: `../data/${key}/graph/knowledge.nodes.jsonl`,
    edgesPath: `../data/${key}/graph/knowledge.edges.jsonl`,
    profilesPath: `../data/${key}/profiles/knowledge.profiles.jsonl`,
    frameworkPath: "../data/frameworks/junior-chemistry-framework.json",
    patternsPath: "../data/patterns/unified-knowledge-patterns.v2.json",
    nodeCardsDir: `../data/${key}/node_cards`,
  };
}

async function discoverSourceConfigs() {
  const versionKeys = await discoverVersionKeys();
  const discovered = await Promise.all(
    versionKeys.map(async (key) => ({
      key,
      autoDiscovered: true,
      discoveredBooks: await discoverBooksForSource(key),
    })),
  );

  return discovered;
}

async function discoverVersionKeys() {
  const entries = await fetchDirectoryEntries(DATA_ROOT_PATH);
  const candidateKeys = entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .filter(
      (name) => VERSION_DIR_PATTERN.test(name) && !RESERVED_DATA_DIRS.has(name),
    );

  const checks = await Promise.all(
    candidateKeys.map(async (key) => {
      const [hasNodes, hasEdges] = await Promise.all([
        fetchExists(`../data/${key}/graph/knowledge.nodes.jsonl`),
        fetchExists(`../data/${key}/graph/knowledge.edges.jsonl`),
      ]);
      return hasNodes && hasEdges ? key : null;
    }),
  );

  return checks.filter(Boolean).sort(compareSourceKeys);
}

async function discoverBooksForSource(sourceKey) {
  const graphDir =
    sourceKey === "v1" ? "../data/graph/" : `../data/${sourceKey}/graph/`;
  const entries = await fetchDirectoryEntries(graphDir);
  const bookIds = new Set();

  entries
    .filter((entry) => !entry.isDirectory)
    .forEach((entry) => {
      const match = entry.name.match(/^(.*)\.(mentions|evidence)\.jsonl$/);
      if (!match || match[1] === "knowledge") {
        return;
      }
      bookIds.add(match[1]);
    });

  return Array.from(bookIds)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((bookId) => ({ book_id: bookId }));
}

function mergeBookSeeds(...groups) {
  const merged = new Map();

  groups.forEach((group) => {
    if (!Array.isArray(group)) {
      return;
    }

    group.forEach((book) => {
      const bookId = book?.book_id || book?.bookId;
      if (!bookId) {
        return;
      }
      merged.set(bookId, { ...(merged.get(bookId) || {}), ...book });
    });
  });

  return Array.from(merged.values());
}

function compareSourceKeys(leftKey, rightKey) {
  const leftRank = getSourceSortRank(leftKey);
  const rightRank = getSourceSortRank(rightKey);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftVersion = getNumericVersion(leftKey);
  const rightVersion = getNumericVersion(rightKey);
  if (leftVersion != null && rightVersion != null && leftVersion !== rightVersion) {
    return leftVersion - rightVersion;
  }

  return leftKey.localeCompare(rightKey, "en", { numeric: true, sensitivity: "base" });
}

function getSourceSortRank(key) {
  if (key === "v1") {
    return 0;
  }
  if (/^v\d+$/i.test(key)) {
    return 1;
  }
  return 2;
}

function getNumericVersion(key) {
  const match = key.match(/^v(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function resolveInitialSourceKey(manifest, sourceConfigs) {
  const params = new URLSearchParams(window.location.search);
  const requestedKey = params.get(SOURCE_QUERY_KEY);
  if (requestedKey && sourceConfigs.has(requestedKey)) {
    return requestedKey;
  }

  const manifestDefault = manifest?.default_source || manifest?.defaultSource;
  if (manifestDefault && sourceConfigs.has(manifestDefault)) {
    return manifestDefault;
  }

  return sourceConfigs.keys().next().value || DEFAULT_SOURCE_KEY;
}

function updateSourceQuery(sourceKey) {
  const url = new URL(window.location.href);
  url.searchParams.set(SOURCE_QUERY_KEY, sourceKey);
  window.history.replaceState({}, "", url);
}

async function switchSource(sourceKey) {
  const source = state.sourceConfigs.get(sourceKey);
  if (!source) {
    return;
  }

  const requestId = ++state.sourceRequestId;
  state.selectedSourceKey = sourceKey;
  state.sourceLoading = true;
  state.cardCache = new Map();
  state.selectedNodeId = null;
  state.hoverNodeId = null;
  state.expandedBackboneNodeId = null;
  renderSourceControl();

  let data;
  try {
    data = await loadProjectData(source);
  } catch (error) {
    data = {
      nodes: [],
      edges: [],
      profiles: [],
      framework: EMPTY_FRAMEWORK,
      patterns: EMPTY_PATTERNS,
      books: [],
      manifest: state.manifest,
      source,
      loadWarnings: [error?.message || "数据源读取失败"],
    };
  }

  if (requestId !== state.sourceRequestId) {
    return;
  }

  state.sourceLoading = false;
  state.data = prepareGraphData(data);
  state.selectedBook = "all";
  state.selectedTypes = new Set(state.data.availableTypes);
  initializeViewport();
  renderControls();
  renderStats();
  renderSearchResults();
  renderDetail();
  draw();
  updateSourceQuery(sourceKey);
}

async function loadProjectData(source) {
  const payload = await fetchJson(source.bundlePath);
  const mergedSource = {
    ...source,
    ...(payload.source || {}),
    hasProfiles: Boolean(
      payload?.source?.hasProfiles ??
        payload?.source?.has_profiles ??
        source.hasProfiles,
    ),
  };
  return {
    nodes: payload.nodes || [],
    edges: payload.edges || [],
    framework: payload.framework || EMPTY_FRAMEWORK,
    patterns: payload.patterns || EMPTY_PATTERNS,
    profiles: payload.profiles || [],
    books: payload.books || [],
    manifest: state.manifest,
    source: mergedSource,
    loadWarnings: payload.loadWarnings || [],
  };
}

function resolveBookIndex(books, sourceKey) {
  return books.map((book) => {
    const bookId = book.book_id || book.bookId;
    const baseGraphPath =
      sourceKey === "v1" ? "../data/graph" : `../data/${sourceKey}/graph`;

    return {
      bookId,
      outlinePath: book.outline_path || book.outlinePath || `../data/outlines/${bookId}.outline.json`,
      mentionsPath:
        book.mentions_path || book.mentionsPath || `${baseGraphPath}/${bookId}.mentions.jsonl`,
      evidencePath:
        book.evidence_path || book.evidencePath || `${baseGraphPath}/${bookId}.evidence.jsonl`,
    };
  });
}

async function loadBookBundles(bookIndex, warnings) {
  const results = await Promise.all(
    bookIndex.map(async (book) => {
      const [outline, mentions, evidence] = await Promise.all([
        fetchResourceJson(book.outlinePath, null, warnings, `目录文件 ${book.bookId}`),
        fetchResourceJsonl(book.mentionsPath, [], warnings, `mentions ${book.bookId}`),
        fetchResourceJsonl(book.evidencePath, [], warnings, `evidence ${book.bookId}`),
      ]);

      const normalizedEvidence = evidence.map((item) => normalizeEvidence(item, book.bookId));
      const evidenceById = new Map(normalizedEvidence.map((item) => [item.id, item]));
      const normalizedMentions = mentions.map((item) =>
        normalizeMention(item, book.bookId, evidenceById),
      );

      if (!book.bookId || (normalizedMentions.length === 0 && normalizedEvidence.length === 0)) {
        return null;
      }
      return {
        bookId: book.bookId,
        outline,
        mentions: normalizedMentions,
        evidence: normalizedEvidence,
      };
    }),
  );

  return results.filter(Boolean);
}

function prepareGraphData({ nodes, edges, profiles, framework, patterns, books, manifest, source, loadWarnings }) {
  const nodeById = new Map();
  const edgeById = new Map();
  const profilesByNodeId = new Map();
  const frameworkTopics = new Map();
  const frameworkDomains = new Map();
  const mentionsByTarget = new Map();
  const evidenceById = new Map();
  const booksById = new Map();
  const patternsById = new Map();
  const patternsByType = new Map();
  const availableTypes = new Set();

  (profiles || []).forEach((profile) => {
    if (!profilesByNodeId.has(profile.node_id)) {
      profilesByNodeId.set(profile.node_id, []);
    }
    profilesByNodeId.get(profile.node_id).push(profile);
  });

  (framework?.domains || []).forEach((domain) => {
    frameworkDomains.set(domain.id, domain);
    (domain.topics || []).forEach((topic) => {
      frameworkTopics.set(topic.id, { ...topic, domain });
    });
  });

  (patterns?.patterns || []).forEach((pattern) => {
    patternsById.set(pattern.id, pattern);
    getPatternKeys(pattern).forEach((key) => {
      if (!patternsByType.has(key)) {
        patternsByType.set(key, []);
      }
      patternsByType.get(key).push(pattern);
    });
  });

  books.forEach((book) => {
    booksById.set(book.bookId, book);
    book.evidence.forEach((item) => evidenceById.set(item.id, item));
    book.mentions.forEach((item) => {
      if (!mentionsByTarget.has(item.target_id)) {
        mentionsByTarget.set(item.target_id, []);
      }
      mentionsByTarget.get(item.target_id).push(item);
    });
  });

  const degreeById = new Map();
  edges.forEach((edge) => {
    degreeById.set(edge.from, (degreeById.get(edge.from) || 0) + 1);
    degreeById.set(edge.to, (degreeById.get(edge.to) || 0) + 1);
  });

  nodes.forEach((node, index) => {
    const profilesForNode = profilesByNodeId.get(node.id) || [];
    const normalizedNode = normalizeNode(node, profilesForNode);
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const radius = 160 + ((index % 7) * 22);
    const graphNode = {
      ...normalizedNode,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      radius:
        (12 + Math.min(12, degreeById.get(node.id) || 0)) *
        (normalizedNode.node_layer === "support" ? 0.84 : 1),
      color: getTypeColor(normalizedNode.node_type),
      degree: degreeById.get(node.id) || 0,
      mentions: mentionsByTarget.get(normalizedNode.id) || [],
      profiles: profilesForNode,
    };
    availableTypes.add(graphNode.node_type);
    nodeById.set(graphNode.id, graphNode);
  });

  const graphEdges = edges
    .map((edge) => {
      const graphEdge = normalizeEdge(edge, nodeById);
      if (!graphEdge) {
        return null;
      }
      edgeById.set(edge.id, graphEdge);
      return graphEdge;
    })
    .filter(Boolean);

  return {
    nodes: Array.from(nodeById.values()),
    edges: graphEdges,
    nodeById,
    edgeById,
    booksById,
    frameworkTopics,
    frameworkDomains,
    patternsById,
    patternsByType,
    evidenceById,
    availableTypes: Array.from(availableTypes).sort((a, b) =>
      getTypeLabel(a).localeCompare(getTypeLabel(b), "zh-CN"),
    ),
    loadWarnings: loadWarnings || [],
    source,
    manifest,
  };
}

function getTypeColor(type) {
  return TYPE_META[type]?.color || TYPE_META.other.color;
}

function getTypeLabel(type) {
  return TYPE_META[type]?.label || humanizeKey(type);
}

function getLearningModeLabel(mode) {
  return LEARNING_MODE_LABELS[mode] || humanizeKey(mode);
}

function getBridgeTagLabel(tag) {
  return BRIDGE_TAG_LABELS[tag] || humanizeKey(tag);
}

function getSchoolStageLabel(stage) {
  return SCHOOL_STAGE_LABELS[stage] || humanizeKey(stage);
}

function getCurriculumRoleLabel(role) {
  return CURRICULUM_ROLE_LABELS[role] || humanizeKey(role);
}

function getMasteryLevelLabel(level) {
  return MASTERY_LEVEL_LABELS[level] || humanizeKey(level);
}

function getNodeLayerLabel(layer) {
  return NODE_LAYER_LABELS[layer] || humanizeKey(layer);
}

function getEdgeLayerLabel(layer) {
  return EDGE_LAYER_LABELS[layer] || humanizeKey(layer);
}

function resolveNodeLayer(node) {
  const explicitLayer =
    node.node_layer ||
    node.layer ||
    node.properties?.node_layer ||
    node.properties?.layer ||
    (node.properties?.backbone === true ? "backbone" : null) ||
    (node.properties?.support === true ? "support" : null);

  if (explicitLayer === "backbone" || explicitLayer === "support") {
    return explicitLayer;
  }

  if (
    node.node_kind === "concept" ||
    node.node_kind === "principle" ||
    node.node_kind === "process" ||
    (node.node_kind === "entity" && (node.node_subkind === "substance" || node.node_subkind === "particle"))
  ) {
    return "backbone";
  }

  return "support";
}

function isBackboneNode(node) {
  return node?.node_layer === "backbone";
}

function isSupportNode(node) {
  return node?.node_layer === "support";
}

function deriveLegacyNodeKind(type) {
  const kindMap = {
    substance: "entity",
    experiment: "activity",
    symbol: "representation",
  };
  return kindMap[type] || type || "other";
}

function deriveDisplayType(node) {
  if (node.node_type) {
    return node.node_type;
  }
  if (node.node_subkind === "substance") {
    return "substance";
  }
  if (node.node_subkind === "experiment") {
    return "experiment";
  }
  if (node.node_subkind === "symbol") {
    return "symbol";
  }
  return node.node_subkind || node.node_kind || "other";
}

function normalizeNode(node, profilesForNode) {
  const profileFrameworkRefs = profilesForNode.flatMap((profile) => profile.framework_refs || []);
  const frameworkRefs = [...new Set([...(node.framework_refs || []), ...profileFrameworkRefs])];
  const normalizedNode = {
    ...node,
    id: node.id,
    name: node.name || node.canonical_name || node.title || node.id,
    description: node.description || node.definition || node.summary || "",
    node_type: deriveDisplayType(node),
    node_kind: node.node_kind || deriveLegacyNodeKind(node.node_type),
    node_subkind: node.node_subkind || null,
    aliases: Array.isArray(node.aliases) ? node.aliases : [],
    framework_refs: frameworkRefs,
    properties: node.properties || {},
  };

  return {
    ...normalizedNode,
    node_layer: resolveNodeLayer(normalizedNode),
  };
}

function resolveEdgeLayer(edge, sourceNode, targetNode) {
  const explicitLayer =
    edge.edge_layer ||
    edge.layer ||
    edge.properties?.edge_layer ||
    edge.properties?.layer ||
    null;

  if (explicitLayer === "backbone" || explicitLayer === "support") {
    return explicitLayer;
  }

  if (isBackboneNode(sourceNode) && isBackboneNode(targetNode)) {
    return "backbone";
  }

  return "support";
}

function resolveBackboneExpand(edge, sourceNode, targetNode) {
  if (typeof edge.backbone_expand === "boolean") {
    return edge.backbone_expand;
  }

  if (typeof edge.properties?.backbone_expand === "boolean") {
    return edge.properties.backbone_expand;
  }

  return (
    (isBackboneNode(sourceNode) && isSupportNode(targetNode)) ||
    (isSupportNode(sourceNode) && isBackboneNode(targetNode))
  );
}

function normalizeEdge(edge, nodeById) {
  const source = nodeById.get(edge.from);
  const target = nodeById.get(edge.to);
  if (!source || !target) {
    return null;
  }

  return {
    ...edge,
    source,
    target,
    edge_layer: resolveEdgeLayer(edge, source, target),
    backbone_expand: resolveBackboneExpand(edge, source, target),
  };
}

function normalizeEvidence(item, fallbackBookId) {
  const pageStart = item.page_start ?? null;
  const pageEnd = item.page_end ?? pageStart;

  return {
    ...item,
    book_id: item.book_id || item.source_id || fallbackBookId,
    source_id: item.source_id || item.book_id || fallbackBookId,
    snippet: item.snippet || item.excerpt || "",
    page_start: pageStart,
    page_end: pageEnd,
  };
}

function normalizeMention(item, fallbackBookId, evidenceById) {
  const bookId = item.book_id || item.source_id || fallbackBookId;
  const firstEvidence = (item.source_refs || []).map((ref) => evidenceById.get(ref)).find(Boolean);

  return {
    ...item,
    book_id: bookId,
    properties: {
      ...(item.properties || {}),
      page: item.properties?.page ?? firstEvidence?.page_start ?? null,
    },
  };
}

function getVisibleMentions(node) {
  return (node.mentions || [])
    .filter((mention) => state.selectedBook === "all" || mention.book_id === state.selectedBook)
    .sort((a, b) => (a.properties?.page || 0) - (b.properties?.page || 0));
}

function getVisibleEvidence(node) {
  const mentions = getVisibleMentions(node);
  const evidenceIds = [...new Set(mentions.flatMap((mention) => mention.source_refs || []))];
  return evidenceIds
    .map((id) => state.data.evidenceById.get(id))
    .filter(Boolean)
    .sort(
      (a, b) =>
        (a.page_start ?? Number.MAX_SAFE_INTEGER) - (b.page_start ?? Number.MAX_SAFE_INTEGER),
    );
}

function getPatternKeys(pattern) {
  const keys = new Set();
  if (pattern.node_type) {
    keys.add(pattern.node_type);
  }
  if (pattern.node_kind) {
    keys.add(pattern.node_kind);
  }
  if (pattern.node_subkind) {
    keys.add(pattern.node_subkind);
  }
  if (pattern.node_kind && pattern.node_subkind) {
    keys.add(`${pattern.node_kind}/${pattern.node_subkind}`);
  }
  return Array.from(keys);
}

function getPatternHints(node) {
  const patternMap = state.data?.patternsByType || new Map();
  const keys = [
    node.node_type,
    node.node_kind,
    node.node_subkind,
    node.node_kind && node.node_subkind ? `${node.node_kind}/${node.node_subkind}` : null,
  ].filter(Boolean);
  const seen = new Set();

  return keys.flatMap((key) => patternMap.get(key) || []).filter((pattern) => {
    if (seen.has(pattern.id)) {
      return false;
    }
    seen.add(pattern.id);
    return true;
  });
}

function bindEvents() {
  window.addEventListener("resize", resizeCanvas);
  els.sourceSelect.addEventListener("change", (event) => {
    switchSource(event.target.value);
  });
  els.collapseSupport.addEventListener("click", () => {
    const expandedRootId = state.expandedBackboneNodeId;
    state.expandedBackboneNodeId = null;
    if (state.selectedNodeId) {
      const selectedNode = state.data?.nodeById.get(state.selectedNodeId);
      if (isSupportNode(selectedNode)) {
        state.selectedNodeId = expandedRootId || null;
      }
    }
    syncSelectionWithVisibility();
    renderControls();
    renderStats();
    renderSearchResults();
    renderDetail();
    draw();
  });
  els.searchInput.addEventListener("input", (event) => {
    state.searchTerm = event.target.value.trim().toLowerCase();
    renderSearchResults();
    draw();
  });
  els.fitView.addEventListener("click", () => {
    initializeViewport();
    draw();
  });
  els.toggleLabels.addEventListener("click", () => {
    state.showLabels = !state.showLabels;
    draw();
  });
  els.resetTypes.addEventListener("click", () => {
    state.selectedTypes = new Set(state.data?.availableTypes || []);
    syncSelectionWithVisibility();
    renderControls();
    renderStats();
    renderSearchResults();
    renderDetail();
    draw();
  });
  els.focusConnected.addEventListener("change", (event) => {
    state.focusConnected = event.target.checked;
    syncSelectionWithVisibility();
    renderStats();
    renderSearchResults();
    renderDetail();
    draw();
  });

  els.canvas.addEventListener("pointerdown", onPointerDown);
  els.canvas.addEventListener("pointermove", onPointerMove);
  els.canvas.addEventListener("pointerup", onPointerUp);
  els.canvas.addEventListener("pointerleave", onPointerUp);
  els.canvas.addEventListener("wheel", onWheel, { passive: false });
}

function initializeViewport() {
  resizeCanvas();
  state.transform = {
    x: els.canvas.width / 2,
    y: els.canvas.height / 2,
    scale: Math.min(1.2, els.canvas.width / 1200 + 0.25),
  };
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = els.canvasWrap.getBoundingClientRect();
  els.canvas.width = rect.width * dpr;
  els.canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function renderControls() {
  renderSourceControl();
  renderLayerModeControl();
  renderTypeFilter();
  renderBookFilter();
  renderLegend();
}

function renderSourceControl() {
  const sources = Array.from(state.sourceConfigs.values());
  if (sources.length === 0) {
    return;
  }

  els.sourceSelect.innerHTML = sources
    .map(
      (source) =>
        `<option value="${escapeHtml(source.key)}">${escapeHtml(source.label)}</option>`,
    )
    .join("");
  els.sourceSelect.value = state.selectedSourceKey || sources[0].key;
  els.sourceSelect.disabled = state.sourceLoading;

  const source = state.sourceConfigs.get(state.selectedSourceKey) || sources[0];
  const warnings = state.data?.loadWarnings || [];
  els.sourceNote.textContent = state.sourceLoading ? "切换中" : source.label;

  const info = [];
  if (source.description) {
    info.push(source.description);
  }
  if (source.autoDiscovered) {
    info.push("自动发现");
  }
  if (source.hasProfiles) {
    info.push("含 profiles");
  }
  if (warnings.length > 0) {
    info.push(`警告：${warnings[0]}`);
  }
  els.sourceHint.textContent = info.join(" | ");
}

function renderLayerModeControl() {
  els.layerMode.innerHTML = "";
  LAYER_MODE_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.className = `segment ${state.layerMode === option.id ? "active" : ""}`;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      state.layerMode = option.id;
      if (option.id === "all") {
        state.expandedBackboneNodeId = null;
      } else {
        state.expandedBackboneNodeId = resolveExpandedBackboneNodeId(state.selectedNodeId);
      }
      syncSelectionWithVisibility();
      renderControls();
      renderStats();
      renderSearchResults();
      renderDetail();
      draw();
    });
    els.layerMode.appendChild(button);
  });

  const expandedNode =
    state.expandedBackboneNodeId && state.data?.nodeById.get(state.expandedBackboneNodeId);
  els.layerNote.textContent =
    state.layerMode === "all" ? "全部可见" : expandedNode ? `已展开 ${expandedNode.name}` : "主干优先";

  const activeMode = LAYER_MODE_OPTIONS.find((option) => option.id === state.layerMode);
  const hints = [activeMode?.description];
  if (state.layerMode === "backbone-expand") {
    hints.push(expandedNode ? `当前展开主干: ${expandedNode.name}` : "点一个主干节点，就会把它的一跳支撑节点展开出来。");
  }
  els.layerHint.textContent = hints.filter(Boolean).join(" | ");
  els.collapseSupport.classList.toggle(
    "hidden",
    !(state.layerMode === "backbone-expand" && expandedNode),
  );
}

function renderTypeFilter() {
  els.typeFilter.innerHTML = "";
  (state.data?.availableTypes || []).forEach((type) => {
    const label = getTypeLabel(type);
    const count = state.data.nodes.filter((node) => node.node_type === type).length;
    const button = document.createElement("button");
    button.className = `chip ${state.selectedTypes.has(type) ? "active" : ""}`;
    button.innerHTML = `${label} <span class="section-note">${count}</span>`;
    button.addEventListener("click", () => {
      if (state.selectedTypes.has(type)) {
        state.selectedTypes.delete(type);
      } else {
        state.selectedTypes.add(type);
      }
      syncSelectionWithVisibility();
      renderTypeFilter();
      renderStats();
      renderSearchResults();
      renderDetail();
      draw();
    });
    els.typeFilter.appendChild(button);
  });
}

function renderBookFilter() {
  const books = ["all", ...state.data.booksById.keys()];
  els.bookFilter.innerHTML = "";
  books.forEach((bookId) => {
    const button = document.createElement("button");
    const label = bookId === "all" ? "全部来源" : bookId;
    button.className = `segment ${state.selectedBook === bookId ? "active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      state.selectedBook = bookId;
      syncSelectionWithVisibility();
      renderBookFilter();
      renderStats();
      renderSearchResults();
      renderDetail();
      draw();
    });
    els.bookFilter.appendChild(button);
  });
}

function renderLegend() {
  els.legend.innerHTML = "";
  (state.data?.availableTypes || []).forEach((type) => {
    const label = getTypeLabel(type);
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-dot" style="background:${getTypeColor(type)}"></span>
      <span>${label}</span>
    `;
    els.legend.appendChild(item);
  });
}

function renderStats() {
  const visibleNodes = getVisibleNodes();
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdgeCount = state.data.edges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  ).length;
  const visibleBackboneCount = visibleNodes.filter((node) => isBackboneNode(node)).length;
  const visibleSupportCount = visibleNodes.filter((node) => isSupportNode(node)).length;
  const stats = [
    ["节点数", visibleNodeIds.size],
    ["主干", visibleBackboneCount],
    ["支撑", visibleSupportCount],
    ["关系数", visibleEdgeCount],
  ];
  els.statsGrid.innerHTML = "";
  stats.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    els.statsGrid.appendChild(card);
  });
}

function renderSearchResults() {
  const allMatches = getSearchMatches();
  const matches = allMatches.slice(0, 60);
  els.searchCount.textContent =
    allMatches.length > matches.length
      ? `前 ${matches.length} / ${allMatches.length} 项`
      : `${allMatches.length} 项`;
  els.searchResults.innerHTML = "";

  if (matches.length === 0) {
    els.searchResults.innerHTML = `
      <div class="empty-state">
        <p>当前筛选下没有匹配结果，可以放宽类型筛选或切换来源范围。</p>
      </div>
    `;
    return;
  }

  matches.forEach((node) => {
    const item = document.createElement("button");
    item.className = `result-item ${state.selectedNodeId === node.id ? "active" : ""}`;
    item.innerHTML = `
      <strong>${node.name}</strong>
      <span>${getNodeLayerLabel(node.node_layer)} · ${getTypeLabel(node.node_type)} · ${node.id}</span>
    `;
    item.addEventListener("click", () => selectNode(node.id, true));
    els.searchResults.appendChild(item);
  });
}

function getExpandedSupportNodeIds() {
  if (state.layerMode !== "backbone-expand" || !state.expandedBackboneNodeId) {
    return new Set();
  }

  const expandedIds = new Set();
  state.data.edges.forEach((edge) => {
    if (!edge.backbone_expand) {
      return;
    }
    if (edge.from === state.expandedBackboneNodeId) {
      const node = state.data.nodeById.get(edge.to);
      if (isSupportNode(node)) {
        expandedIds.add(node.id);
      }
    }
    if (edge.to === state.expandedBackboneNodeId) {
      const node = state.data.nodeById.get(edge.from);
      if (isSupportNode(node)) {
        expandedIds.add(node.id);
      }
    }
  });
  return expandedIds;
}

function getNeighborEntries(node) {
  return state.data.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const otherNode = state.data.nodeById.get(otherId);
      return {
        edge,
        otherNode,
      };
    })
    .filter((entry) => entry.otherNode);
}

function getBackboneNeighbors(nodeId) {
  const node = state.data?.nodeById.get(nodeId);
  if (!node) {
    return [];
  }

  return getNeighborEntries(node)
    .filter((entry) => entry.edge.backbone_expand)
    .map((entry) => entry.otherNode)
    .filter((otherNode) => isBackboneNode(otherNode));
}

function nodePassesBaseFilters(node) {
  if (!node || !state.selectedTypes.has(node.node_type)) {
    return false;
  }

  if (state.selectedBook !== "all") {
    return node.mentions.some((mention) => mention.book_id === state.selectedBook);
  }

  return true;
}

function getVisibleNodes() {
  let nodes = state.data.nodes.filter((node) => nodePassesBaseFilters(node));

  if (state.layerMode === "backbone-expand") {
    const expandedRootNode =
      state.expandedBackboneNodeId && state.data.nodeById.get(state.expandedBackboneNodeId);
    const expandedSupportIds =
      expandedRootNode && nodePassesBaseFilters(expandedRootNode)
        ? getExpandedSupportNodeIds()
        : new Set();
    nodes = nodes.filter((node) => {
      if (isBackboneNode(node)) {
        return true;
      }
      if (expandedSupportIds.has(node.id)) {
        return true;
      }
      return node.id === state.selectedNodeId;
    });
  }

  if (state.focusConnected && state.selectedNodeId) {
    const connected = new Set([state.selectedNodeId]);
    state.data.edges.forEach((edge) => {
      if (edge.from === state.selectedNodeId) {
        connected.add(edge.to);
      }
      if (edge.to === state.selectedNodeId) {
        connected.add(edge.from);
      }
    });
    nodes = nodes.filter((node) => connected.has(node.id));
  }

  return nodes;
}

function getVisibleEdges(visibleNodeIds) {
  return state.data.edges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  );
}

function syncSelectionWithVisibility() {
  const expandedRoot =
    state.expandedBackboneNodeId && state.data?.nodeById.get(state.expandedBackboneNodeId);
  if (expandedRoot && !nodePassesBaseFilters(expandedRoot)) {
    state.expandedBackboneNodeId = null;
  }

  const visibleNodeIds = new Set(getVisibleNodes().map((node) => node.id));
  if (state.selectedNodeId && !visibleNodeIds.has(state.selectedNodeId)) {
    state.selectedNodeId = null;
    state.hoverNodeId = null;
  }
}

function getSearchMatches() {
  const visibleNodes = getVisibleNodes();
  if (!state.searchTerm) {
    return visibleNodes
      .slice()
      .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, "zh-CN"));
  }

  return visibleNodes
    .filter((node) => {
      const haystack = [
        node.id,
        node.name,
        node.description,
        ...(node.aliases || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(state.searchTerm);
    })
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, "zh-CN"));
}

function startSimulation() {
  const tick = () => {
    stepSimulation();
    draw();
    state.raf = requestAnimationFrame(tick);
  };
  if (!state.raf) {
    state.raf = requestAnimationFrame(tick);
  }
}

function stepSimulation() {
  const visibleNodes = getVisibleNodes();
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = getVisibleEdges(visibleNodeIds);

  if (visibleNodes.length === 0) {
    return;
  }

  const centering = 0.0018;
  const repulsion = 4200;
  const spring = 0.009;
  const idealLength = 135;

  for (let i = 0; i < visibleNodes.length; i += 1) {
    const a = visibleNodes[i];
    for (let j = i + 1; j < visibleNodes.length; j += 1) {
      const b = visibleNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 1) {
        dx = (Math.random() - 0.5) * 0.2;
        dy = (Math.random() - 0.5) * 0.2;
        distSq = dx * dx + dy * dy;
      }
      const force = repulsion / distSq;
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      a.vx -= nx * force;
      a.vy -= ny * force;
      b.vx += nx * force;
      b.vy += ny * force;
    }
  }

  visibleEdges.forEach((edge) => {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const delta = dist - idealLength;
    const nx = dx / dist;
    const ny = dy / dist;
    const force = delta * spring;
    edge.source.vx += nx * force;
    edge.source.vy += ny * force;
    edge.target.vx -= nx * force;
    edge.target.vy -= ny * force;
  });

  visibleNodes.forEach((node) => {
    if (node.fx != null && node.fy != null) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
      return;
    }

    node.vx += -node.x * centering;
    node.vy += -node.y * centering;
    node.vx *= 0.84;
    node.vy *= 0.84;
    node.x += node.vx;
    node.y += node.vy;
  });
}

function draw() {
  if (!state.data) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const width = els.canvas.width / dpr;
  const height = els.canvas.height / dpr;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(state.transform.x / dpr, state.transform.y / dpr);
  ctx.scale(state.transform.scale, state.transform.scale);

  const visibleNodes = getVisibleNodes();
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = getVisibleEdges(visibleNodeIds);

  drawEdges(visibleEdges);
  drawNodes(visibleNodes);

  ctx.restore();
}

function drawEdges(edges) {
  edges.forEach((edge) => {
    const selected = state.selectedNodeId && (edge.from === state.selectedNodeId || edge.to === state.selectedNodeId);
    const supportEdge = edge.edge_layer === "support";
    ctx.beginPath();
    ctx.setLineDash(supportEdge ? [5, 5] : []);
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.strokeStyle = selected
      ? supportEdge
        ? "rgba(158, 79, 43, 0.42)"
        : "rgba(158, 79, 43, 0.58)"
      : supportEdge
        ? "rgba(82, 62, 45, 0.11)"
        : "rgba(82, 62, 45, 0.18)";
    ctx.lineWidth = selected ? 2.2 : supportEdge ? 0.95 : 1.15;
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawNodes(nodes) {
  nodes.forEach((node) => {
    const hovered = state.hoverNodeId === node.id;
    const selected = state.selectedNodeId === node.id;
    const searchMatched =
      state.searchTerm &&
      [node.id, node.name, node.description, ...(node.aliases || [])]
        .join(" ")
        .toLowerCase()
        .includes(state.searchTerm);

    const radius = node.radius * (selected ? 1.25 : hovered ? 1.12 : 1);
    const supportNode = isSupportNode(node);
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = supportNode ? `${node.color}CC` : node.color;
    ctx.fill();
    ctx.lineWidth = selected ? 4 : hovered || searchMatched ? 3 : 1.6;
    ctx.strokeStyle =
      selected
        ? supportNode
          ? "rgba(255, 243, 229, 0.85)"
          : "rgba(250, 247, 241, 0.95)"
        : hovered || searchMatched
          ? "rgba(255, 245, 235, 0.85)"
          : supportNode
            ? "rgba(255, 248, 239, 0.34)"
            : "rgba(255, 248, 239, 0.48)";
    ctx.stroke();

    if (!state.showLabels && !selected && !hovered) {
      return;
    }

    if (state.transform.scale < 0.65 && !selected && !hovered) {
      return;
    }

    ctx.font = selected ? '600 14px "Avenir Next"' : '500 12px "Avenir Next"';
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(40, 29, 20, 0.95)";
    ctx.fillText(node.name, node.x, node.y + radius + 16);
  });
}

function graphToScreen(node) {
  return {
    x: node.x * state.transform.scale + state.transform.x / (window.devicePixelRatio || 1),
    y: node.y * state.transform.scale + state.transform.y / (window.devicePixelRatio || 1),
  };
}

function screenToGraph(x, y) {
  return {
    x: (x - state.transform.x / (window.devicePixelRatio || 1)) / state.transform.scale,
    y: (y - state.transform.y / (window.devicePixelRatio || 1)) / state.transform.scale,
  };
}

function pickNode(x, y) {
  const point = screenToGraph(x, y);
  const visibleNodes = getVisibleNodes();
  for (let i = visibleNodes.length - 1; i >= 0; i -= 1) {
    const node = visibleNodes[i];
    const dx = point.x - node.x;
    const dy = point.y - node.y;
    if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 6) {
      return node;
    }
  }
  return null;
}

function onPointerDown(event) {
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const node = pickNode(x, y);

  if (node) {
    state.dragNodeId = node.id;
    node.fx = node.x;
    node.fy = node.y;
    selectNode(node.id);
  } else {
    state.panning = true;
  }

  state.lastPointer = { x: event.clientX, y: event.clientY };
  els.canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  const rect = els.canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const hoveredNode = pickNode(localX, localY);
  state.hoverNodeId = hoveredNode?.id || null;

  if (state.dragNodeId) {
    const node = state.data.nodeById.get(state.dragNodeId);
    const point = screenToGraph(localX, localY);
    node.fx = point.x;
    node.fy = point.y;
  } else if (state.panning && state.lastPointer) {
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    state.transform.x += dx * (window.devicePixelRatio || 1);
    state.transform.y += dy * (window.devicePixelRatio || 1);
    state.lastPointer = { x: event.clientX, y: event.clientY };
  }

  draw();
}

function onPointerUp(event) {
  if (state.dragNodeId) {
    const node = state.data.nodeById.get(state.dragNodeId);
    node.fx = null;
    node.fy = null;
  }
  state.dragNodeId = null;
  state.panning = false;
  state.lastPointer = null;
  if (event.pointerId != null) {
    try {
      els.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore release errors
    }
  }
}

function onWheel(event) {
  event.preventDefault();
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const zoom = Math.exp(-event.deltaY * 0.0012);
  const current = screenToGraph(x, y);
  state.transform.scale = clamp(state.transform.scale * zoom, 0.32, 2.45);
  const after = screenToGraph(x, y);
  state.transform.x += (after.x - current.x) * state.transform.scale * (window.devicePixelRatio || 1);
  state.transform.y += (after.y - current.y) * state.transform.scale * (window.devicePixelRatio || 1);
  draw();
}

function resolveExpandedBackboneNodeId(nodeId) {
  if (state.layerMode !== "backbone-expand" || !nodeId) {
    return null;
  }

  const node = state.data?.nodeById.get(nodeId);
  if (!node) {
    return null;
  }

  if (isBackboneNode(node)) {
    return node.id;
  }

  if (isSupportNode(node) && state.expandedBackboneNodeId) {
    const currentRoot = state.data.nodeById.get(state.expandedBackboneNodeId);
    if (currentRoot) {
      const relatedBackboneIds = new Set(getBackboneNeighbors(node.id).map((item) => item.id));
      if (relatedBackboneIds.has(currentRoot.id)) {
        return currentRoot.id;
      }
    }
  }

  return getBackboneNeighbors(node.id)[0]?.id || state.expandedBackboneNodeId || null;
}

function selectNode(nodeId, recenter = false) {
  state.selectedNodeId = nodeId;
  state.expandedBackboneNodeId = resolveExpandedBackboneNodeId(nodeId);
  syncSelectionWithVisibility();
  renderLayerModeControl();
  renderStats();
  renderSearchResults();
  renderDetail();
  if (recenter) {
    centerOnNode(nodeId);
  }
  draw();
}

function centerOnNode(nodeId) {
  const node = state.data.nodeById.get(nodeId);
  if (!node) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  state.transform.x = els.canvas.width / 2 - node.x * state.transform.scale * dpr;
  state.transform.y = els.canvas.height / 2 - node.y * state.transform.scale * dpr;
}

async function renderDetail() {
  const requestId = ++state.detailRequestId;
  const node = state.selectedNodeId ? state.data.nodeById.get(state.selectedNodeId) : null;
  if (!node) {
    els.detailEmpty.classList.remove("hidden");
    els.detailContent.classList.add("hidden");
    return;
  }

  els.detailEmpty.classList.add("hidden");
  els.detailContent.classList.remove("hidden");
  els.detailType.textContent = getTypeLabel(node.node_type);
  els.detailTitle.textContent = node.name;
  els.detailDescription.textContent = node.description || "暂无摘要。";

  renderBadges(node);
  renderKnowledgeAxes(node);
  renderProfiles(node);
  renderAliases(node);
  renderProperties(node.properties || {});
  renderSupportNodes(node);
  renderRelations(node);
  renderMentions(node);
  renderEvidence(node);
  await renderNodeCard(node, requestId);
}

function renderBadges(node) {
  els.detailBadges.innerHTML = "";
  const visibleMentions = getVisibleMentions(node);
  const visibleEvidence = getVisibleEvidence(node);
  const sourceScopeLabel = state.selectedBook === "all" ? "当前来源" : "当前教材";
  const badges = [
    getNodeLayerLabel(node.node_layer),
    node.id,
    `${node.degree} 条关联`,
    `${sourceScopeLabel} ${visibleMentions.length} 条出现`,
    `${sourceScopeLabel} ${visibleEvidence.length} 条证据`,
    ...(node.profiles || []).slice(0, 2).map((profile) => `${profile.subject} ${profile.grade_band}`),
    ...(node.framework_refs || []).slice(0, 2).map((ref) => {
      const topic = state.data.frameworkTopics.get(ref);
      return topic ? topic.title : ref;
    }),
  ];
  badges.forEach((badgeText) => {
    const badge = document.createElement("span");
    badge.className = "badge active";
    badge.textContent = badgeText;
    els.detailBadges.appendChild(badge);
  });
}

function renderAliases(node) {
  els.detailAliases.innerHTML = "";
  const aliases = node.aliases && node.aliases.length ? node.aliases : ["无"];
  aliases.forEach((alias) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = alias;
    els.detailAliases.appendChild(pill);
  });
}

function renderKnowledgeAxes(node) {
  const ontologyChips = [
    node.node_kind ? getTypeLabel(node.node_kind) : null,
    node.node_subkind ? getTypeLabel(node.node_subkind) : null,
    node.node_type && node.node_type !== node.node_kind && node.node_type !== node.node_subkind
      ? `显示类型 ${getTypeLabel(node.node_type)}`
      : null,
  ].filter(Boolean);

  const learningModeChips = (node.learning_modes || []).map((mode) => getLearningModeLabel(mode));
  const bridgeTagChips = (node.bridge_tags || []).map((tag) => getBridgeTagLabel(tag));

  const sections = [
    {
      title: "本体类型",
      summary: "节点在统一知识地图中的主轴分类。",
      chips: ontologyChips,
    },
    {
      title: "学习方式",
      summary: "这个节点更偏向哪种学习处理方式。",
      chips: learningModeChips,
    },
    {
      title: "跨学科桥标签",
      summary: "用于跨学科连接和后续知识图谱扩展的桥接标签。",
      chips: bridgeTagChips,
    },
  ];

  els.detailAxis.innerHTML = sections
    .map((section) => {
      const content =
        section.chips.length > 0
          ? `<div class="micro-list">${section.chips
              .map((chip) => `<span class="micro-chip">${escapeHtml(chip)}</span>`)
              .join("")}</div>`
          : `<p>当前数据源里还没有这部分信息。</p>`;

      return `
        <div class="axis-group">
          <h4>${section.title}</h4>
          <p>${section.summary}</p>
          ${content}
        </div>
      `;
    })
    .join("");
}

function renderProfiles(node) {
  const profiles = (node.profiles || []).slice().sort((a, b) => {
    const subjectCompare = String(a.subject || "").localeCompare(String(b.subject || ""), "zh-CN");
    if (subjectCompare !== 0) {
      return subjectCompare;
    }
    return String(a.grade_band || "").localeCompare(String(b.grade_band || ""), "zh-CN");
  });

  if (profiles.length === 0) {
    els.detailProfiles.innerHTML = `
      <div class="empty-state">
        <p>当前数据源里还没有这个节点的课程画像。</p>
      </div>
    `;
    return;
  }

  els.detailProfiles.innerHTML = profiles
    .map((profile) => {
      const header = [
        profile.subject || "未标注学科",
        getSchoolStageLabel(profile.school_stage),
        profile.grade_band ? `${profile.grade_band} 年级/学段` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const chips = [
        profile.id,
        getCurriculumRoleLabel(profile.curriculum_role),
        getMasteryLevelLabel(profile.mastery_level),
        ...(profile.framework_refs || []).slice(0, 2),
      ].filter(Boolean);

      const objectives =
        profile.learning_objectives?.length > 0
          ? `<ul class="card-list">${profile.learning_objectives
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}</ul>`
          : `<p>暂无学习目标描述。</p>`;

      const assessmentSignals =
        profile.assessment_signals?.length > 0
          ? `<div class="micro-list">${profile.assessment_signals
              .map((item) => `<span class="micro-chip">${escapeHtml(item)}</span>`)
              .join("")}</div>`
          : "";

      return `
        <div class="profile-item">
          <h4>${escapeHtml(header)}</h4>
          <div class="micro-list">
            ${chips.map((chip) => `<span class="micro-chip">${escapeHtml(chip)}</span>`).join("")}
          </div>
          ${objectives}
          ${assessmentSignals}
        </div>
      `;
    })
    .join("");
}

function renderProperties(properties) {
  els.detailProperties.innerHTML = "";
  const entries = Object.entries(properties || {});
  if (entries.length === 0) {
    els.detailProperties.innerHTML = `
      <div class="empty-state">
        <p>这个节点目前还没有结构属性。</p>
      </div>
    `;
    return;
  }

  entries.forEach(([key, value]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "property-group";
    wrapper.innerHTML = `
      <div class="property-label">${humanizeKey(key)}</div>
      <div class="property-value">${renderValue(value)}</div>
    `;
    els.detailProperties.appendChild(wrapper);
  });
}

function renderSupportNodes(node) {
  const neighborEntries = getNeighborEntries(node).sort((a, b) =>
    a.otherNode.name.localeCompare(b.otherNode.name, "zh-CN"),
  );
  const expansionEntries = neighborEntries.filter((entry) => entry.edge.backbone_expand);
  const supportEntries = expansionEntries.filter((entry) => isSupportNode(entry.otherNode));
  const backboneEntries = expansionEntries.filter((entry) => isBackboneNode(entry.otherNode));

  if (isBackboneNode(node)) {
    els.detailSupportNote.textContent = supportEntries.length
      ? `${supportEntries.length} 个一跳支撑节点`
      : "当前没有一跳支撑节点";

    if (supportEntries.length === 0) {
      els.detailSupport.innerHTML = `
        <div class="empty-state">
          <p>这个主干节点目前还没有拆出支撑节点，后续可以继续补方法、实验、表征等支撑层。</p>
        </div>
      `;
      return;
    }

    els.detailSupport.innerHTML = supportEntries
      .map(
        ({ edge, otherNode }) => `
          <button class="support-item" data-node-id="${otherNode.id}">
            <strong>${escapeHtml(otherNode.name)}</strong>
            <span>${escapeHtml(getTypeLabel(otherNode.node_type))} · ${escapeHtml(edge.edge_type)} · 主干展开</span>
          </button>
        `,
      )
      .join("");
  } else {
    els.detailSupportNote.textContent = backboneEntries.length
      ? `${backboneEntries.length} 个所属主干`
      : "当前是支撑节点";

    if (backboneEntries.length === 0) {
      els.detailSupport.innerHTML = `
        <div class="empty-state">
          <p>这个支撑节点暂时还没有挂接到明确的主干节点。</p>
        </div>
      `;
      return;
    }

    els.detailSupport.innerHTML = backboneEntries
      .map(
        ({ edge, otherNode }) => `
          <button class="support-item support-item-backbone" data-node-id="${otherNode.id}">
            <strong>${escapeHtml(otherNode.name)}</strong>
            <span>${escapeHtml(getNodeLayerLabel(otherNode.node_layer))} · ${escapeHtml(edge.edge_type)} · 主干展开</span>
          </button>
        `,
      )
      .join("");
  }

  els.detailSupport.querySelectorAll("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => selectNode(button.dataset.nodeId, true));
  });
}

function normalizeCardContent(content) {
  if (Array.isArray(content)) {
    return content.map((item) => String(item));
  }

  if (content == null) {
    return [];
  }

  if (typeof content === "string" || typeof content === "number" || typeof content === "boolean") {
    return [String(content)];
  }

  if (typeof content === "object") {
    return Object.entries(content).map(([key, value]) => `${humanizeKey(key)}: ${String(value)}`);
  }

  return [String(content)];
}

function normalizeNodeCard(card, node) {
  return {
    ...card,
    card_layer:
      card.card_layer ||
      card.layer ||
      card.properties?.card_layer ||
      node?.node_layer ||
      "support",
  };
}

async function renderNodeCard(node, requestId) {
  const patternHints = getPatternHints(node);

  els.cardStatus.textContent = "加载中";
  els.detailCard.innerHTML = `
    <div class="empty-state">
      <p>正在读取这个节点的说明卡...</p>
    </div>
  `;

  const rawCard = await loadNodeCard(node.id);
  if (requestId !== state.detailRequestId || state.selectedNodeId !== node.id) {
    return;
  }

  const card = rawCard ? normalizeNodeCard(rawCard, node) : null;

  if (!card) {
    renderMissingNodeCard(patternHints, node);
    return;
  }

  els.cardStatus.textContent = `${card.status || "draft"} · ${getNodeLayerLabel(card.card_layer)}卡`;
  const sectionsHtml = (card.sections || [])
    .map(
      (section) => `
        <div class="card-section">
          <h4>${section.title}</h4>
          <ul class="card-list">
            ${normalizeCardContent(section.content)
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}
          </ul>
          ${
            section.source_refs?.length
              ? `<div class="micro-list">${section.source_refs
                  .map((ref) => `<span class="micro-chip">${ref}</span>`)
                  .join("")}</div>`
              : ""
          }
        </div>
      `,
    )
    .join("");

  const patternChips = (card.pattern_refs || [])
    .map((ref) => `<span class="micro-chip">${ref}</span>`)
    .join("");
  const layerChip = `<span class="micro-chip">${escapeHtml(getNodeLayerLabel(card.card_layer))}卡</span>`;

  els.detailCard.innerHTML = `
    <div class="card-section">
      <h4>概要</h4>
      <p>${escapeHtml(card.summary || "暂无概要。")}</p>
      <div class="micro-list">${layerChip}${patternChips}</div>
    </div>
    ${sectionsHtml}
  `;
}

function renderMissingNodeCard(patternHints, node) {
  els.cardStatus.textContent = `尚未生成 · ${getNodeLayerLabel(node.node_layer)}卡`;
  els.detailCard.innerHTML = `
    <div class="empty-state">
      <p>当前还没有这个节点的 node card，可以用 <code>@node-expander</code> 为它生成详细说明。</p>
      <p>如果这是当前批次里的主干节点，建议在 QA 通过后把它纳入批量扩卡目标。</p>
    </div>
    ${patternHints
      .map((pattern) => {
        const required = pattern.sections
          .filter((section) => section.required)
          .map((section) => section.title)
          .join("、");
        return `
          <div class="card-section">
            <h4>${pattern.title}</h4>
            <p>${pattern.summary}</p>
            <div class="micro-list">
              <span class="micro-chip">${pattern.id}</span>
              <span class="micro-chip">必备 section: ${required}</span>
            </div>
          </div>
        `;
      })
      .join("")}
  `;
}

function renderRelations(node) {
  const relatedEdges = state.data.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .slice()
    .sort((a, b) => b.confidence - a.confidence);

  if (relatedEdges.length === 0) {
    els.detailRelations.innerHTML = `
      <div class="empty-state"><p>这个节点当前还没有关联关系。</p></div>
    `;
    return;
  }

  els.detailRelations.innerHTML = relatedEdges
    .map((edge) => {
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const otherNode = state.data.nodeById.get(otherId);
      return `
        <button class="relation-item" data-node-id="${otherId}">
          <h4>${edge.edge_type} · ${otherNode?.name || otherId}</h4>
          <p>${escapeHtml(edge.backbone_expand ? "主干展开" : getEdgeLayerLabel(edge.edge_layer || "support"))} · ${escapeHtml(getNodeLayerLabel(otherNode?.node_layer || "other"))} · ${escapeHtml(getTypeLabel(otherNode?.node_type || "other"))} · ${escapeHtml(edge.properties?.relation || edge.properties?.relation_note || "无附加说明")}</p>
        </button>
      `;
    })
    .join("");

  els.detailRelations.querySelectorAll("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => selectNode(button.dataset.nodeId, true));
  });
}

function renderMentions(node) {
  const mentions = getVisibleMentions(node);

  if (mentions.length === 0) {
    const scopeLabel = state.selectedBook === "all" ? "当前来源范围" : "当前教材";
    els.detailMentions.innerHTML = `
      <div class="empty-state">
        <p>${scopeLabel}下没有这个节点的教材出现记录。</p>
        <p>这通常表示该版本输出里还没有为这个节点写入对应的 mention。</p>
      </div>
    `;
    return;
  }

  const outlineTitleByAnchor = new Map();
  state.data.booksById.forEach((book) => {
    (book.outline?.items || []).forEach((item) => {
      outlineTitleByAnchor.set(item.id, `${item.label} ${item.title}`);
    });
  });

  els.detailMentions.innerHTML = mentions
    .map((mention) => {
      const chips = [
        mention.book_id,
        `页码 ${mention.properties?.page ?? "?"}`,
        outlineTitleByAnchor.get(mention.anchor_ref) || mention.anchor_ref,
      ];
      return `
        <div class="mention-item">
          <h4>${escapeHtml(mention.properties?.book_context || mention.role)}</h4>
          <p>${escapeHtml(mention.role)} · ${escapeHtml(mention.anchor_ref)}</p>
          <div class="micro-list">
            ${chips.map((chip) => `<span class="micro-chip">${escapeHtml(chip)}</span>`).join("")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderEvidence(node) {
  const evidence = getVisibleEvidence(node);

  if (evidence.length === 0) {
    els.detailEvidence.innerHTML = `
      <div class="empty-state">
        <p>当前没有关联证据。</p>
        <p>这通常表示 mention 的 <code>source_refs</code> 还没有连到有效 evidence。</p>
      </div>
    `;
    return;
  }

  els.detailEvidence.innerHTML = evidence
    .map(
      (item) => `
        <div class="evidence-item">
          <h4>${item.id}</h4>
          <p>${escapeHtml(item.snippet)}</p>
          <div class="micro-list">
            <span class="micro-chip">${
              item.page_start != null
                ? `p.${item.page_start}${item.page_end !== item.page_start ? `-${item.page_end}` : ""}`
                : escapeHtml(item.locator || "无页码")
            }</span>
            <span class="micro-chip">${escapeHtml(item.book_id)}</span>
            <span class="micro-chip">${escapeHtml(item.anchor_ref)}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

async function loadNodeCard(nodeId) {
  if (state.cardCache.has(nodeId)) {
    return state.cardCache.get(nodeId);
  }
  const basePath =
    state.data?.source?.nodeCardPath ||
    `${API_BASE}/source/${encodeURIComponent(state.selectedSourceKey || "")}/node-card`;
  const card = await fetchOptionalJson(`${basePath}/${encodeURIComponent(nodeId)}`);
  state.cardCache.set(nodeId, card);
  return card;
}

async function fetchResourceJson(path, fallback, warnings, label) {
  if (!path) {
    return fallback;
  }

  try {
    const response = await fetch(path);
    if (!response.ok) {
      warnings.push(`${label} 未找到: ${path}`);
      return fallback;
    }
    return await response.json();
  } catch (error) {
    warnings.push(`${label} 读取失败: ${path}`);
    return fallback;
  }
}

async function fetchResourceJsonl(path, fallback, warnings, label) {
  if (!path) {
    return fallback;
  }

  try {
    const response = await fetch(path);
    if (!response.ok) {
      warnings.push(`${label} 未找到: ${path}`);
      return fallback;
    }
    const text = await response.text();
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    warnings.push(`${label} 读取失败: ${path}`);
    return fallback;
  }
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

async function fetchOptionalJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    return null;
  }
  return response.json();
}

async function fetchJsonl(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function fetchOptionalJsonl(path) {
  const response = await fetch(path);
  if (!response.ok) {
    return [];
  }
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function fetchDirectoryEntries(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return [];
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return [];
    }

    const html = await response.text();
    return parseDirectoryEntries(path, html);
  } catch (error) {
    return [];
  }
}

function parseDirectoryEntries(path, html) {
  const baseUrl = new URL(path, window.location.href);
  const basePath = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const entries = new Map();

  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href) {
      return;
    }

    let resolvedUrl;
    try {
      resolvedUrl = new URL(href, baseUrl);
    } catch (error) {
      return;
    }

    if (resolvedUrl.origin !== baseUrl.origin || !resolvedUrl.pathname.startsWith(basePath)) {
      return;
    }

    const relativePath = resolvedUrl.pathname.slice(basePath.length);
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length !== 1) {
      return;
    }

    const name = decodeURIComponent(segments[0]);
    if (!name || name === "." || name === "..") {
      return;
    }

    entries.set(name, {
      name,
      isDirectory: relativePath.endsWith("/") || anchor.textContent.trim().endsWith("/"),
    });
  });

  return Array.from(entries.values());
}

async function fetchExists(path) {
  try {
    let response = await fetch(path, { method: "HEAD" });
    if (response.ok) {
      return true;
    }

    if (response.status === 405) {
      response = await fetch(path);
      return response.ok;
    }

    return false;
  } catch (error) {
    return false;
  }
}

function renderValue(value) {
  if (Array.isArray(value)) {
    return `<ul class="property-list">${value.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>`;
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(
        ([key, item]) => `
          <div class="property-group">
            <div class="property-label">${humanizeKey(key)}</div>
            <div class="property-value">${renderValue(item)}</div>
          </div>
        `,
      )
      .join("");
  }
  return escapeHtml(String(value));
}

function humanizeKey(key) {
  return key
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
