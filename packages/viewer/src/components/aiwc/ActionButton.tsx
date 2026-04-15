import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { useTokens } from "../../hooks/useTokens.js";
import type { TokenSet } from "./styles/tokens";

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
  const t = useTokens();
  const variantStyle = resolveVariantStyle(variant, disabled, t);

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...createBaseButtonStyle(t),
        ...variantStyle
      }}
      type={type}
    >
      {children}
    </button>
  );
}

function createBaseButtonStyle(t: TokenSet): CSSProperties {
  return {
    alignItems: "center",
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: t.radiusPill,
    color: t.colorText,
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
  };
}

function resolveVariantStyle(
  variant: NonNullable<ActionButtonProps["variant"]>,
  disabled: boolean,
  t: TokenSet
): CSSProperties {
  if (disabled) {
    return {
      cursor: "not-allowed",
      opacity: 0.5
    };
  }

  if (variant === "primary") {
    return {
      background: t.colorAccent,
      borderColor: t.colorAccent,
      color: t.colorSurface
    };
  }

  if (variant === "danger") {
    return {
      background: t.colorDangerSoft,
      borderColor: t.colorDangerSoft,
      color: t.colorDanger
    };
  }

  return {};
}
