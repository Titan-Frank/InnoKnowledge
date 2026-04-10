import type { AppState, GraphNode } from '../state.js';
import type { DomElements } from '../types/dom-elements.js';
import type { ApiNodeCard } from '@okm/types';
import {
  NODE_LAYER_LABELS, EDGE_LAYER_LABELS,
  LEARNING_MODE_LABELS, BRIDGE_TAG_LABELS,
  SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS, MASTERY_LEVEL_LABELS,
} from '../types/constants.js';
import {
  escapeHtml, humanizeKey, getTypeLabel, renderValue,
  isBackboneNode, isSupportNode,
} from '../graph/layout.js';
import {
  getNeighborEntries, getVisibleMentions, getVisibleEvidence,
} from '../graph/visibility.js';
import { loadNodeCard } from '../api.js';

export async function renderDetail(
  state: AppState,
  els: DomElements,
  callbacks: {
    selectNode: (id: string, recenter?: boolean) => void;
    draw: () => void;
    renderControls: () => void;
    renderStats: () => void;
    renderSearchResults: () => void;
  },
): Promise<void> {
  const requestId = ++state.detailRequestId;
  const node = state.selectedNodeId ? state.data?.nodeById.get(state.selectedNodeId) : null;
  if (!node) {
    els.detailEmpty.classList.remove('hidden');
    els.detailContent.classList.add('hidden');
    return;
  }

  els.detailEmpty.classList.add('hidden');
  els.detailContent.classList.remove('hidden');
  els.detailType.textContent = getTypeLabel(node.node_type);
  els.detailTitle.textContent = node.name;
  els.detailDescription.textContent = node.description || '暂无摘要。';

  renderBadges(node, state, els);
  renderKnowledgeAxes(node, els);
  renderProfiles(node, els);
  renderAliases(node, els);
  renderProperties((node.properties ?? {}) as Record<string, unknown>, els);
  renderSupportNodes(node, state, els, callbacks);
  renderRelations(node, state, els, callbacks);
  renderMentions(node, state, els);
  renderEvidence(node, state, els);
  await renderNodeCard(node, state, els, requestId);
}

function renderBadges(node: GraphNode, state: AppState, els: DomElements): void {
  els.detailBadges.innerHTML = '';
  const visibleMentions = getVisibleMentions(node, state);
  const visibleEvidence = getVisibleEvidence(node, state);
  const sourceScopeLabel = state.selectedBook === 'all' ? '当前来源' : '当前教材';
  const badges: string[] = [
    NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer),
    node.id,
    `${node.degree} 条关联`,
    `${sourceScopeLabel} ${visibleMentions.length} 条出现`,
    `${sourceScopeLabel} ${visibleEvidence.length} 条证据`,
    ...(node.profiles || []).slice(0, 2).map((profile) => `${profile.subject} ${profile.grade_band}`),
    ...(node.framework_refs || []).slice(0, 2).map((ref) => {
      const topic = state.data?.frameworkTopics.get(ref);
      return topic ? topic.title : ref;
    }),
  ];
  badges.forEach((badgeText) => {
    const badge = document.createElement('span');
    badge.className = 'badge active';
    badge.textContent = badgeText;
    els.detailBadges.appendChild(badge);
  });
}

function renderAliases(node: GraphNode, els: DomElements): void {
  els.detailAliases.innerHTML = '';
  const aliases = node.aliases && node.aliases.length ? node.aliases : ['无'];
  aliases.forEach((alias) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = alias;
    els.detailAliases.appendChild(pill);
  });
}

function renderKnowledgeAxes(node: GraphNode, els: DomElements): void {
  const ontologyChips = [
    node.node_kind ? getTypeLabel(node.node_kind) : null,
    node.node_subkind ? getTypeLabel(node.node_subkind) : null,
    node.node_type && node.node_type !== node.node_kind && node.node_type !== node.node_subkind
      ? `显示类型 ${getTypeLabel(node.node_type)}`
      : null,
  ].filter(Boolean) as string[];

  const learningModeChips = (node.learning_modes || []).map((mode) =>
    LEARNING_MODE_LABELS[mode] ?? humanizeKey(mode),
  );
  const bridgeTagChips = (node.bridge_tags || []).map((tag) =>
    BRIDGE_TAG_LABELS[tag] ?? humanizeKey(tag),
  );

  const sections = [
    { title: '本体类型', summary: '节点在统一知识地图中的主轴分类。', chips: ontologyChips },
    { title: '学习方式', summary: '这个节点更偏向哪种学习处理方式。', chips: learningModeChips },
    { title: '跨学科桥标签', summary: '用于跨学科连接和后续知识图谱扩展的桥接标签。', chips: bridgeTagChips },
  ];

  els.detailAxis.innerHTML = sections
    .map((section) => {
      const content =
        section.chips.length > 0
          ? `<div class="micro-list">${section.chips
              .map((chip) => `<span class="micro-chip">${escapeHtml(chip)}</span>`)
              .join('')}</div>`
          : `<p>当前数据源里还没有这部分信息。</p>`;
      return `
        <div class="axis-group">
          <h4>${section.title}</h4>
          <p>${section.summary}</p>
          ${content}
        </div>
      `;
    })
    .join('');
}

function renderProfiles(node: GraphNode, els: DomElements): void {
  const profiles = (node.profiles || []).slice().sort((a, b) => {
    const subjectCompare = String(a.subject || '').localeCompare(String(b.subject || ''), 'zh-CN');
    if (subjectCompare !== 0) return subjectCompare;
    return String(a.grade_band || '').localeCompare(String(b.grade_band || ''), 'zh-CN');
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
        profile.subject || '未标注学科',
        SCHOOL_STAGE_LABELS[profile.school_stage] ?? humanizeKey(profile.school_stage),
        profile.grade_band ? `${profile.grade_band} 年级/学段` : null,
      ].filter(Boolean).join(' · ');

      const chips = [
        profile.id,
        CURRICULUM_ROLE_LABELS[profile.curriculum_role] ?? humanizeKey(profile.curriculum_role),
        MASTERY_LEVEL_LABELS[profile.mastery_level] ?? humanizeKey(profile.mastery_level),
        ...(profile.framework_refs || []).slice(0, 2),
      ].filter(Boolean);

      const objectives =
        profile.learning_objectives?.length > 0
          ? `<ul class="card-list">${profile.learning_objectives
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join('')}</ul>`
          : `<p>暂无学习目标描述。</p>`;

      const assessmentSignals =
        (profile as Record<string, unknown>).assessment_signals &&
        Array.isArray((profile as Record<string, unknown>).assessment_signals) &&
        ((profile as Record<string, unknown>).assessment_signals as string[]).length > 0
          ? `<div class="micro-list">${((profile as Record<string, unknown>).assessment_signals as string[])
              .map((item) => `<span class="micro-chip">${escapeHtml(item)}</span>`)
              .join('')}</div>`
          : '';

      return `
        <div class="profile-item">
          <h4>${escapeHtml(header)}</h4>
          <div class="micro-list">
            ${chips.map((chip) => `<span class="micro-chip">${escapeHtml(chip)}</span>`).join('')}
          </div>
          ${objectives}
          ${assessmentSignals}
        </div>
      `;
    })
    .join('');
}

function renderProperties(properties: Record<string, unknown>, els: DomElements): void {
  els.detailProperties.innerHTML = '';
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
    const wrapper = document.createElement('div');
    wrapper.className = 'property-group';
    wrapper.innerHTML = `
      <div class="property-label">${humanizeKey(key)}</div>
      <div class="property-value">${renderValue(value)}</div>
    `;
    els.detailProperties.appendChild(wrapper);
  });
}

function renderSupportNodes(
  node: GraphNode,
  state: AppState,
  els: DomElements,
  callbacks: { selectNode: (id: string, recenter?: boolean) => void },
): void {
  const neighborEntries = getNeighborEntries(node, state).sort((a, b) =>
    a.otherNode.name.localeCompare(b.otherNode.name, 'zh-CN'),
  );
  const supportNeighbors = neighborEntries.filter((entry) => isSupportNode(entry.otherNode));
  const backboneNeighbors = neighborEntries.filter((entry) => isBackboneNode(entry.otherNode));
  const expansionEntries = neighborEntries.filter((entry) => entry.edge.backbone_expand);
  const supportEntries = expansionEntries.filter((entry) => isSupportNode(entry.otherNode));
  const backboneEntries = expansionEntries.filter((entry) => isBackboneNode(entry.otherNode));

  if (isBackboneNode(node)) {
    els.detailSupportNote.textContent = supportEntries.length
      ? `${supportEntries.length} 个一跳支撑节点`
      : '当前没有一跳支撑节点';

    if (supportEntries.length === 0) {
      const fallbackNote =
        supportNeighbors.length > 0
          ? '当前图里已经有支撑层邻居，但它们的边还没有标成 backbone_expand，所以暂时不能作为主干展开显示。'
          : '这个主干节点目前还没有拆出支撑节点，后续可以继续补方法、实验、表征等支撑层。';
      els.detailSupport.innerHTML = `
        <div class="empty-state">
          <p>${fallbackNote}</p>
        </div>
      `;
      return;
    }

    els.detailSupport.innerHTML = supportEntries
      .map(({ edge, otherNode }) => `
        <button class="support-item" data-node-id="${otherNode.id}">
          <strong>${escapeHtml(otherNode.name)}</strong>
          <span>${escapeHtml(getTypeLabel(otherNode.node_type))} · ${escapeHtml(edge.edge_type)} · 主干展开</span>
        </button>
      `)
      .join('');
  } else {
    els.detailSupportNote.textContent = backboneEntries.length
      ? `${backboneEntries.length} 个所属主干`
      : '当前是支撑节点';

    if (backboneEntries.length === 0) {
      const fallbackNote =
        backboneNeighbors.length > 0
          ? '当前图里已经有相邻主干节点，但连接边还没有标成 backbone_expand，所以这里暂时看不到所属主干。'
          : '这个支撑节点暂时还没有挂接到明确的主干节点。';
      els.detailSupport.innerHTML = `
        <div class="empty-state">
          <p>${fallbackNote}</p>
        </div>
      `;
      return;
    }

    els.detailSupport.innerHTML = backboneEntries
      .map(({ edge, otherNode }) => `
        <button class="support-item support-item-backbone" data-node-id="${otherNode.id}">
          <strong>${escapeHtml(otherNode.name)}</strong>
          <span>${escapeHtml(NODE_LAYER_LABELS[otherNode.node_layer] ?? humanizeKey(otherNode.node_layer))} · ${escapeHtml(edge.edge_type)} · 主干展开</span>
        </button>
      `)
      .join('');
  }

  els.detailSupport.querySelectorAll('[data-node-id]').forEach((button) => {
    button.addEventListener('click', () =>
      callbacks.selectNode((button as HTMLElement).dataset.nodeId!, true),
    );
  });
}

function renderRelations(
  node: GraphNode,
  state: AppState,
  els: DomElements,
  callbacks: { selectNode: (id: string, recenter?: boolean) => void },
): void {
  const relatedEdges = state.data!.edges
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
      const otherNode = state.data!.nodeById.get(otherId);
      const edgeProps = edge.properties as Record<string, unknown> | undefined;
      return `
        <button class="relation-item" data-node-id="${otherId}">
          <h4>${edge.edge_type} · ${otherNode?.name || otherId}</h4>
          <p>${escapeHtml(edge.backbone_expand ? '主干展开' : EDGE_LAYER_LABELS[edge.edge_layer ?? 'support'] ?? humanizeKey(edge.edge_layer ?? 'support'))} · ${escapeHtml(NODE_LAYER_LABELS[otherNode?.node_layer ?? 'other'] ?? humanizeKey(otherNode?.node_layer ?? 'other'))} · ${escapeHtml(getTypeLabel(otherNode?.node_type ?? 'other'))} · ${escapeHtml(String(edgeProps?.relation || edgeProps?.relation_note || '无附加说明'))}</p>
        </button>
      `;
    })
    .join('');

  els.detailRelations.querySelectorAll('[data-node-id]').forEach((button) => {
    button.addEventListener('click', () =>
      callbacks.selectNode((button as HTMLElement).dataset.nodeId!, true),
    );
  });
}

function renderMentions(node: GraphNode, state: AppState, els: DomElements): void {
  const mentions = getVisibleMentions(node, state);

  if (mentions.length === 0) {
    const scopeLabel = state.selectedBook === 'all' ? '当前来源范围' : '当前教材';
    els.detailMentions.innerHTML = `
      <div class="empty-state">
        <p>${scopeLabel}下没有这个节点的教材出现记录。</p>
        <p>这通常表示该版本输出里还没有为这个节点写入对应的 mention。</p>
      </div>
    `;
    return;
  }

  const outlineTitleByAnchor = new Map<string, string>();
  state.data!.booksById.forEach((book) => {
    const items = (book.outline as Record<string, unknown>)?.items as Array<Record<string, unknown>> | undefined;
    (items || []).forEach((item) => {
      outlineTitleByAnchor.set(item.id as string, `${item.label} ${item.title}`);
    });
  });

  els.detailMentions.innerHTML = mentions
    .map((mention) => {
      const mentionProps = mention.properties as Record<string, unknown>;
      const chips = [
        (mention as Record<string, unknown>).book_id as string,
        `页码 ${mentionProps?.page ?? '?'}`,
        outlineTitleByAnchor.get(mention.anchor_ref) || mention.anchor_ref,
      ];
      return `
        <div class="mention-item">
          <h4>${escapeHtml(String(mentionProps?.book_context || mention.role))}</h4>
          <p>${escapeHtml(mention.role)} · ${escapeHtml(mention.anchor_ref)}</p>
          <div class="micro-list">
            ${chips.map((chip) => `<span class="micro-chip">${escapeHtml(chip)}</span>`).join('')}
          </div>
        </div>
      `;
    })
    .join('');
}

function renderEvidence(node: GraphNode, state: AppState, els: DomElements): void {
  const evidence = getVisibleEvidence(node, state);

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
    .map((item) => {
      const itemAny = item as Record<string, unknown>;
      return `
        <div class="evidence-item">
          <h4>${item.id}</h4>
          <p>${escapeHtml(String(itemAny.snippet || ''))}</p>
          <div class="micro-list">
            <span class="micro-chip">${
              itemAny.page_start != null
                ? `p.${itemAny.page_start}${itemAny.page_end !== itemAny.page_start ? `-${itemAny.page_end}` : ''}`
                : escapeHtml(String(item.locator || '无页码'))
            }</span>
            <span class="micro-chip">${escapeHtml(String(itemAny.book_id || item.source_id))}</span>
            <span class="micro-chip">${escapeHtml(item.anchor_ref)}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

async function renderNodeCard(
  node: GraphNode,
  state: AppState,
  els: DomElements,
  requestId: number,
): Promise<void> {
  const patternHints = getPatternHints(node, state);

  els.cardStatus.textContent = '加载中';
  els.detailCard.innerHTML = `
    <div class="empty-state">
      <p>正在读取这个节点的说明卡...</p>
    </div>
  `;

  const nodeCardPath =
    state.data?.source?.nodeCardPath ||
    `/api/source/${encodeURIComponent(state.selectedSourceKey || '')}/node-card`;

  let rawCard: ApiNodeCard | null = null;
  if (state.cardCache.has(node.id)) {
    rawCard = state.cardCache.get(node.id) ?? null;
  } else {
    rawCard = await loadNodeCard(nodeCardPath, node.id);
    state.cardCache.set(node.id, rawCard);
  }

  if (requestId !== state.detailRequestId || state.selectedNodeId !== node.id) return;

  const card = rawCard ? normalizeNodeCard(rawCard, node) : null;

  if (!card) {
    renderMissingNodeCard(patternHints, node, els);
    return;
  }

  els.cardStatus.textContent = `${card.status || 'draft'} · ${NODE_LAYER_LABELS[card.card_layer] ?? humanizeKey(card.card_layer)}卡`;
  const sectionsHtml = (card.sections || [])
    .map((section) => `
      <div class="card-section">
        <h4>${section.title}</h4>
        <ul class="card-list">
          ${normalizeCardContent(section.content)
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join('')}
        </ul>
        ${
          section.source_refs?.length
            ? `<div class="micro-list">${section.source_refs
                .map((ref) => `<span class="micro-chip">${ref}</span>`)
                .join('')}</div>`
            : ''
        }
      </div>
    `)
    .join('');

  const patternChips = (card.pattern_refs || [])
    .map((ref) => `<span class="micro-chip">${ref}</span>`)
    .join('');
  const layerChip = `<span class="micro-chip">${escapeHtml(NODE_LAYER_LABELS[card.card_layer] ?? humanizeKey(card.card_layer))}卡</span>`;

  els.detailCard.innerHTML = `
    <div class="card-section">
      <h4>概要</h4>
      <p>${escapeHtml(card.summary || '暂无概要。')}</p>
      <div class="micro-list">${layerChip}${patternChips}</div>
    </div>
    ${sectionsHtml}
  `;
}

function normalizeCardContent(content: unknown): string[] {
  if (Array.isArray(content)) return content.map((item) => String(item));
  if (content == null) return [];
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') {
    return [String(content)];
  }
  if (typeof content === 'object') {
    return Object.entries(content as Record<string, unknown>).map(([key, value]) => `${humanizeKey(key)}: ${String(value)}`);
  }
  return [String(content)];
}

function normalizeNodeCard(card: ApiNodeCard, node: GraphNode): ApiNodeCard & { card_layer: string } {
  return {
    ...card,
    card_layer:
      card.card_layer ||
      (card as Record<string, unknown>).layer as string | undefined ||
      (card.properties as Record<string, unknown> | undefined)?.card_layer as string | undefined ||
      node?.node_layer ||
      'support',
  } as ApiNodeCard & { card_layer: string };
}

function getPatternHints(node: GraphNode, state: AppState): Record<string, unknown>[] {
  const patternMap = state.data?.patternsByType || new Map();
  const keys = [
    node.node_type,
    node.node_kind,
    node.node_subkind,
    node.node_kind && node.node_subkind ? `${node.node_kind}/${node.node_subkind}` : null,
  ].filter(Boolean) as string[];
  const seen = new Set<string>();

  return keys.flatMap((key) => patternMap.get(key) || []).filter((pattern) => {
    if (seen.has(pattern.id as string)) return false;
    seen.add(pattern.id as string);
    return true;
  });
}

function renderMissingNodeCard(
  patternHints: Record<string, unknown>[],
  node: GraphNode,
  els: DomElements,
): void {
  els.cardStatus.textContent = `尚未生成 · ${NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer)}卡`;
  els.detailCard.innerHTML = `
    <div class="empty-state">
      <p>当前还没有这个节点的 node card，可以用 <code>@node-expander</code> 为它生成详细说明。</p>
      <p>如果这是当前批次里的主干节点，建议在 QA 通过后把它纳入批量扩卡目标。</p>
    </div>
    ${patternHints
      .map((pattern) => {
        const sections = pattern.sections as Array<Record<string, unknown>> | undefined;
        const required = (sections || [])
          .filter((section) => section.required)
          .map((section) => section.title)
          .join('、');
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
      .join('')}
  `;
}
