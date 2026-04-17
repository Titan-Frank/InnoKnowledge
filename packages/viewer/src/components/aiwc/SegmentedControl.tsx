import type { CSSProperties } from "react";
import { useTokens } from "../../hooks/useTokens.js";
import type { TokenSet } from "./styles/tokens";

export type SegmentedControlItem = {
  id: string;
  label: string;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  value: string;
  items: SegmentedControlItem[];
  onChange?: (value: string) => void;
  ariaLabel?: string;
};

export function SegmentedControl({ value, items, onChange, ariaLabel }: SegmentedControlProps) {
  const t = useTokens();

  return (
    <div aria-label={ariaLabel} role="tablist" style={createRootStyle(t)}>
      {items.map((item) => {
        const active = item.id === value;
        const disabled = item.disabled || !onChange;

        return (
          <button
            aria-selected={active}
            disabled={disabled}
            key={item.id}
            onClick={() => onChange?.(item.id)}
            role="tab"
            style={{
              ...createButtonStyle(t),
              ...(active ? createActiveButtonStyle(t) : null),
              ...(disabled ? disabledButtonStyle : null)
            }}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function createRootStyle(t: TokenSet): CSSProperties {
  return {
    alignItems: "center",
    background: t.colorSurfaceMuted,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 12,
    display: "inline-flex",
    flexWrap: "wrap",
    gap: 4,
    padding: 4
  };
}

function createButtonStyle(t: TokenSet): CSSProperties {
  return {
    background: "transparent",
    border: "none",
    borderRadius: t.radiusPill,
    color: t.colorTextSubtle,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    minHeight: 30,
    padding: "7px 12px",
    whiteSpace: "normal",
    wordBreak: "break-word",
  };
}

function createActiveButtonStyle(t: TokenSet): CSSProperties {
  return {
    background: t.colorSurface,
    color: t.colorText
  };
}

const disabledButtonStyle = {
  cursor: "not-allowed",
  opacity: 0.5
} satisfies CSSProperties;
