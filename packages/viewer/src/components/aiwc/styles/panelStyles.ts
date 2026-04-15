import type { CSSProperties } from "react";
import type { TokenSet } from "./tokens";



export type PanelTone = "neutral" | "accent" | "secondary" | "success" | "warning" | "danger";

type TonePalette = {
  background: string;
  border: string;
  text: string;
};

function getTonePalettes(t: TokenSet): Record<PanelTone, TonePalette> {
  return {
    neutral: {
      background: t.colorSurfaceMuted,
      border: t.colorBorder,
      text: t.colorTextSubtle
    },
    accent: {
      background: t.colorAccentSoft,
      border: t.colorBorderStrong,
      text: t.colorAccent
    },
    secondary: {
      background: t.colorSecondaryAccentSoft,
      border: t.colorBorder,
      text: t.colorSecondaryAccent
    },
    success: {
      background: t.colorSuccessSoft,
      border: t.colorSuccessSoft,
      text: t.colorSuccess
    },
    warning: {
      background: t.colorWarningSoft,
      border: t.colorWarningSoft,
      text: t.colorWarning
    },
    danger: {
      background: t.colorDangerSoft,
      border: t.colorDangerSoft,
      text: t.colorDanger
    }
  };
}

export function createPanelSurfaceStyle(t: TokenSet): CSSProperties {
  return {
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: t.radius,
    boxShadow: "none",
    overflow: "hidden"
  };
}

export function createPanelHeaderStyle(t: TokenSet): CSSProperties {
  return {
    alignItems: "start",
    borderBottom: `1px solid ${t.colorBorder}`,
    display: "flex",
    gap: 16,
    justifyContent: "space-between",
    padding: "14px 16px"
  };
}

export const panelHeaderMainStyle = {
  display: "grid",
  gap: 4
} satisfies CSSProperties;

export const panelTitleRowStyle = {
  alignItems: "center",
  display: "flex",
  gap: 12
} satisfies CSSProperties;

export function createPanelTitleStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorText,
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "-0.01em"
  };
}

export function createPanelSubtitleStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorMuted,
    fontSize: 13,
    lineHeight: 1.5
  };
}

export const panelBodyStyle = {
  display: "grid",
  gap: 14,
  padding: 16
} satisfies CSSProperties;

export function createSectionLabelStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorMuted,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase"
  };
}

export const stackedMetaStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8
} satisfies CSSProperties;

export function createToneBadgeStyle(tone: PanelTone, t: TokenSet): CSSProperties {
  const palette = getTonePalettes(t)[tone];

  return {
    alignItems: "center",
    background: palette.background,
    border: `1px solid ${palette.border}`,
    borderRadius: t.radiusPill,
    color: palette.text,
    display: "inline-flex",
    fontSize: 11,
    fontWeight: 700,
    gap: 6,
    padding: "4px 9px",
    whiteSpace: "nowrap"
  };
}

export function createStateCardStyle(tone: PanelTone, t: TokenSet): CSSProperties {
  const palette = getTonePalettes(t)[tone];

  return {
    background: palette.background,
    border: `1px solid ${palette.border}`,
    borderRadius: t.radiusSmall,
    color: palette.text,
    display: "grid",
    gap: 6,
    padding: "16px"
  };
}

export function createIconFrameStyle(tone: PanelTone, t: TokenSet): CSSProperties {
  const palette = getTonePalettes(t)[tone];

  return {
    alignItems: "center",
    background: palette.background,
    border: `1px solid ${palette.border}`,
    borderRadius: t.radiusSmall,
    color: palette.text,
    display: "inline-flex",
    flexShrink: 0,
    height: 30,
    justifyContent: "center",
    width: 30
  };
}

export function createGhostButtonStyle(interactive: boolean, t: TokenSet): CSSProperties {
  return {
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: t.radiusPill,
    color: t.colorText,
    cursor: interactive ? "pointer" : "default",
    fontSize: 12,
    fontWeight: 700,
    padding: "7px 11px"
  };
}

export function createSelectableCardStyle(active: boolean, t: TokenSet): CSSProperties {
  return {
    background: active ? t.colorSurfaceMuted : t.colorSurface,
    border: `1px solid ${active ? t.colorBorderStrong : t.colorBorder}`,
    borderRadius: t.radiusSmall,
    boxShadow: "none"
  };
}
