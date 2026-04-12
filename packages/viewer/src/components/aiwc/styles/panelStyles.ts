import type { CSSProperties } from "react";
import { aiWebComponentTokens } from "./tokens";

export type PanelTone = "neutral" | "accent" | "secondary" | "success" | "warning" | "danger";

type TonePalette = {
  background: string;
  border: string;
  text: string;
};

const tonePalettes: Record<PanelTone, TonePalette> = {
  neutral: {
    background: aiWebComponentTokens.colorSurfaceMuted,
    border: aiWebComponentTokens.colorBorder,
    text: aiWebComponentTokens.colorTextSubtle
  },
  accent: {
    background: aiWebComponentTokens.colorAccentSoft,
    border: aiWebComponentTokens.colorBorderStrong,
    text: aiWebComponentTokens.colorAccent
  },
  secondary: {
    background: aiWebComponentTokens.colorSecondaryAccentSoft,
    border: aiWebComponentTokens.colorBorder,
    text: aiWebComponentTokens.colorSecondaryAccent
  },
  success: {
    background: aiWebComponentTokens.colorSuccessSoft,
    border: "#bde8d3",
    text: aiWebComponentTokens.colorSuccess
  },
  warning: {
    background: aiWebComponentTokens.colorWarningSoft,
    border: "#f7de95",
    text: "#b7791f"
  },
  danger: {
    background: aiWebComponentTokens.colorDangerSoft,
    border: "#f6c5d1",
    text: aiWebComponentTokens.colorDanger
  }
};

export const panelSurfaceStyle = {
  background: aiWebComponentTokens.colorSurface,
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radius,
  boxShadow: "none",
  overflow: "hidden"
} satisfies CSSProperties;

export const panelHeaderStyle = {
  alignItems: "start",
  borderBottom: `1px solid ${aiWebComponentTokens.colorBorder}`,
  display: "flex",
  gap: 16,
  justifyContent: "space-between",
  padding: "14px 16px"
} satisfies CSSProperties;

export const panelHeaderMainStyle = {
  display: "grid",
  gap: 4
} satisfies CSSProperties;

export const panelTitleRowStyle = {
  alignItems: "center",
  display: "flex",
  gap: 12
} satisfies CSSProperties;

export const panelTitleStyle = {
  color: aiWebComponentTokens.colorText,
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: "-0.01em"
} satisfies CSSProperties;

export const panelSubtitleStyle = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: 13,
  lineHeight: 1.5
} satisfies CSSProperties;

export const panelBodyStyle = {
  display: "grid",
  gap: 14,
  padding: 16
} satisfies CSSProperties;

export const sectionLabelStyle = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase"
} satisfies CSSProperties;

export const stackedMetaStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8
} satisfies CSSProperties;

export function createToneBadgeStyle(tone: PanelTone = "accent"): CSSProperties {
  const palette = tonePalettes[tone];

  return {
    alignItems: "center",
    background: palette.background,
    border: `1px solid ${palette.border}`,
    borderRadius: aiWebComponentTokens.radiusPill,
    color: palette.text,
    display: "inline-flex",
    fontSize: 11,
    fontWeight: 700,
    gap: 6,
    padding: "4px 9px",
    whiteSpace: "nowrap"
  };
}

export function createStateCardStyle(tone: PanelTone = "neutral"): CSSProperties {
  const palette = tonePalettes[tone];

  return {
    background: palette.background,
    border: `1px solid ${palette.border}`,
    borderRadius: aiWebComponentTokens.radiusSmall,
    color: palette.text,
    display: "grid",
    gap: 6,
    padding: "16px"
  };
}

export function createIconFrameStyle(tone: PanelTone = "accent"): CSSProperties {
  const palette = tonePalettes[tone];

  return {
    alignItems: "center",
    background: palette.background,
    border: `1px solid ${palette.border}`,
    borderRadius: aiWebComponentTokens.radiusSmall,
    color: palette.text,
    display: "inline-flex",
    flexShrink: 0,
    height: 30,
    justifyContent: "center",
    width: 30
  };
}

export function createGhostButtonStyle(interactive: boolean): CSSProperties {
  return {
    background: aiWebComponentTokens.colorSurface,
    border: `1px solid ${aiWebComponentTokens.colorBorder}`,
    borderRadius: aiWebComponentTokens.radiusPill,
    color: aiWebComponentTokens.colorText,
    cursor: interactive ? "pointer" : "default",
    fontSize: 12,
    fontWeight: 700,
    padding: "7px 11px"
  };
}

export function createSelectableCardStyle(active: boolean): CSSProperties {
  return {
    background: active ? aiWebComponentTokens.colorSurfaceMuted : aiWebComponentTokens.colorSurface,
    border: `1px solid ${active ? aiWebComponentTokens.colorBorderStrong : aiWebComponentTokens.colorBorder}`,
    borderRadius: aiWebComponentTokens.radiusSmall,
    boxShadow: "none"
  };
}
