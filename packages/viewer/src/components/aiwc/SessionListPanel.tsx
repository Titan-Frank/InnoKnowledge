import type { ReactNode } from "react";
import { PanelStateBlock } from "./shared/PanelStateBlock";
import {
  createIconFrameStyle,
  createSelectableCardStyle,
  createToneBadgeStyle,
  panelBodyStyle,
  panelHeaderMainStyle,
  panelHeaderStyle,
  panelSubtitleStyle,
  panelSurfaceStyle,
  panelTitleRowStyle,
  panelTitleStyle
} from "./styles/panelStyles";
import { aiWebComponentTokens } from "./styles/tokens";

export type SessionListItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
};

export type SessionListPanelProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  titleIcon?: ReactNode;
  hideHeader?: boolean;
  items: SessionListItem[];
  activeItemId?: string;
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  errorState?: ReactNode;
  emptyVisual?: ReactNode;
  emptyAction?: ReactNode;
  loadingVisual?: ReactNode;
  loadingAction?: ReactNode;
  errorVisual?: ReactNode;
  errorAction?: ReactNode;
  status?: "idle" | "loading" | "error";
  headerActions?: ReactNode;
  onSelect?: (item: SessionListItem) => void;
  renderItemActions?: (item: SessionListItem) => ReactNode;
};

export function SessionListPanel({
  title = "对话列表",
  subtitle,
  titleIcon,
  hideHeader = false,
  items,
  activeItemId,
  emptyState,
  loadingState,
  errorState,
  emptyVisual,
  emptyAction,
  loadingVisual,
  loadingAction,
  errorVisual,
  errorAction,
  status = "idle",
  headerActions,
  onSelect,
  renderItemActions
}: SessionListPanelProps) {
  const showError = status === "error";
  const showEmpty = items.length === 0 && status === "idle";
  const showLoading = items.length === 0 && status === "loading";
  const surfaceStyle = hideHeader
    ? { ...panelSurfaceStyle, background: "transparent", border: "none", borderRadius: 0 }
    : panelSurfaceStyle;
  const bodyStyle = hideHeader ? { ...panelBodyStyle, gap: 8, padding: 0 } : { ...panelBodyStyle, gap: 10 };

  return (
    <section style={surfaceStyle}>
      {!hideHeader ? (
        <header style={panelHeaderStyle}>
          <div style={panelHeaderMainStyle}>
            <div style={panelTitleRowStyle}>
              {titleIcon ? <span style={createIconFrameStyle("accent")}>{titleIcon}</span> : null}
              <div style={panelTitleStyle}>{title}</div>
            </div>
            {subtitle ? <div style={panelSubtitleStyle}>{subtitle}</div> : null}
            <span style={createToneBadgeStyle("neutral")}>共 {items.length} 个会话</span>
          </div>
          {headerActions ? <div>{headerActions}</div> : null}
        </header>
      ) : null}

      <div style={bodyStyle}>
        {showError ? (
          <PanelStateBlock
            action={errorAction}
            description={errorState ?? "会话列表加载失败，请稍后重试。"}
            title="暂时无法读取会话列表"
            tone="danger"
            visual={errorVisual}
          />
        ) : null}

        {showLoading ? (
          <PanelStateBlock
            action={loadingAction}
            description={loadingState ?? "正在加载会话列表..."}
            title="正在同步会话记录"
            tone="accent"
            visual={loadingVisual}
          />
        ) : null}

        {showEmpty ? (
          <PanelStateBlock
            action={emptyAction}
            description={emptyState ?? "当前还没有会话。"}
            title="还没有会话"
            tone="neutral"
            visual={emptyVisual}
          />
        ) : null}

        {items.map((item) => {
          const isActive = item.id === activeItemId;
          const itemActions = renderItemActions?.(item);
          const disabled = item.disabled || !onSelect;

          return (
            <article
              key={item.id}
              style={{
                ...createSelectableCardStyle(isActive),
                borderLeft: `2px solid ${
                  isActive ? aiWebComponentTokens.colorAccent : "transparent"
                }`,
                display: "grid",
                gap: 6,
                opacity: item.disabled ? 0.6 : 1,
                padding: "10px 12px"
              }}
            >
              <button
                disabled={disabled}
                onClick={() => onSelect?.(item)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: disabled ? "default" : "pointer",
                  display: "grid",
                  gap: 6,
                  padding: 0,
                  textAlign: "left"
                }}
                type="button"
              >
                <div
                  style={{
                    alignItems: "start",
                    display: "flex",
                    gap: 12,
                    justifyContent: "space-between"
                  }}
                >
                  <strong style={{ color: aiWebComponentTokens.colorText }}>{item.title}</strong>
                  {item.badge ? (
                    <span style={createToneBadgeStyle(isActive ? "accent" : "neutral")}>
                      {item.badge}
                    </span>
                  ) : null}
                </div>
                {item.description ? (
                  <span style={{ color: aiWebComponentTokens.colorMuted, fontSize: 14 }}>{item.description}</span>
                ) : null}
                {item.meta ? (
                  <span style={{ color: aiWebComponentTokens.colorMuted, fontSize: 12 }}>{item.meta}</span>
                ) : null}
              </button>
              {itemActions ? <div style={{ marginTop: 10 }}>{itemActions}</div> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
