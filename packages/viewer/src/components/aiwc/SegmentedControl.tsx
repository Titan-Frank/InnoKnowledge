import type { CSSProperties } from "react";
import { aiWebComponentTokens } from "./styles/tokens";

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
  return (
    <div aria-label={ariaLabel} role="tablist" style={rootStyle}>
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
              ...buttonStyle,
              ...(active ? activeButtonStyle : null),
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

const rootStyle = {
  alignItems: "center",
  background: aiWebComponentTokens.colorSurfaceMuted,
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusPill,
  display: "inline-flex",
  gap: 4,
  padding: 4
} satisfies CSSProperties;

const buttonStyle = {
  background: "transparent",
  border: "none",
  borderRadius: aiWebComponentTokens.radiusPill,
  color: aiWebComponentTokens.colorTextSubtle,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  minHeight: 30,
  padding: "7px 12px",
  whiteSpace: "nowrap"
} satisfies CSSProperties;

const activeButtonStyle = {
  background: aiWebComponentTokens.colorSurface,
  color: aiWebComponentTokens.colorText
} satisfies CSSProperties;

const disabledButtonStyle = {
  cursor: "not-allowed",
  opacity: 0.5
} satisfies CSSProperties;
