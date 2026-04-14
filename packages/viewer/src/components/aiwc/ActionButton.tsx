import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { aiWebComponentTokens } from "./styles/tokens";

export type ActionButtonProps = {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  variant?: "ghost" | "primary" | "danger";
};

export function ActionButton({
  children,
  onClick,
  disabled = false,
  type = "button",
  variant = "ghost"
}: ActionButtonProps) {
  const variantStyle = resolveVariantStyle(variant, disabled);

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...baseButtonStyle,
        ...variantStyle
      }}
      type={type}
    >
      {children}
    </button>
  );
}

const baseButtonStyle = {
  alignItems: "center",
  background: aiWebComponentTokens.colorSurface,
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusPill,
  color: aiWebComponentTokens.colorText,
  cursor: "pointer",
  display: "inline-flex",
  fontSize: 12,
  fontWeight: 700,
  gap: 6,
  justifyContent: "center",
  lineHeight: 1,
  minHeight: 34,
  padding: "8px 12px",
  whiteSpace: "nowrap"
} satisfies CSSProperties;

function resolveVariantStyle(
  variant: NonNullable<ActionButtonProps["variant"]>,
  disabled: boolean
): CSSProperties {
  if (disabled) {
    return {
      cursor: "not-allowed",
      opacity: 0.5
    };
  }

  if (variant === "primary") {
    return {
      background: aiWebComponentTokens.colorAccent,
      borderColor: aiWebComponentTokens.colorAccent,
      color: aiWebComponentTokens.colorSurface
    };
  }

  if (variant === "danger") {
    return {
      background: aiWebComponentTokens.colorDangerSoft,
      borderColor: "rgba(239, 68, 68, 0.3)",
      color: aiWebComponentTokens.colorDanger
    };
  }

  return {};
}
