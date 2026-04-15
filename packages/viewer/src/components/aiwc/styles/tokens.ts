export type ThemeMode = 'light' | 'dark';

export interface TokenSet {
  colorPage: string;
  colorSurface: string;
  colorSurfaceMuted: string;
  colorSurfaceRaised: string;
  colorSurfaceAccent: string;
  colorBorder: string;
  colorBorderStrong: string;
  colorText: string;
  colorTextSubtle: string;
  colorMuted: string;
  colorAccent: string;
  colorAccentStrong: string;
  colorAccentSoft: string;
  colorSecondaryAccent: string;
  colorSecondaryAccentSoft: string;
  colorSuccess: string;
  colorSuccessSoft: string;
  colorWarning: string;
  colorWarningSoft: string;
  colorDanger: string;
  colorDangerSoft: string;
  radius: number;
  radiusSmall: number;
  radiusPill: number;
  shadow: string;
  shadowSoft: string;
}

export const darkTokens: TokenSet = {
  colorPage: "#06060a",
  colorSurface: "#101018",
  colorSurfaceMuted: "#0a0a10",
  colorSurfaceRaised: "#16161f",
  colorSurfaceAccent: "rgba(124, 58, 237, 0.08)",
  colorBorder: "#1e1e2a",
  colorBorderStrong: "#2a2a3a",
  colorText: "#e4e4ed",
  colorTextSubtle: "#8888a0",
  colorMuted: "#5a5a70",
  colorAccent: "#7c3aed",
  colorAccentStrong: "#6d28d9",
  colorAccentSoft: "rgba(124, 58, 237, 0.15)",
  colorSecondaryAccent: "#8C55FF",
  colorSecondaryAccentSoft: "rgba(140, 85, 255, 0.15)",
  colorSuccess: "#10b981",
  colorSuccessSoft: "rgba(16, 185, 129, 0.15)",
  colorWarning: "#f59e0b",
  colorWarningSoft: "rgba(245, 158, 11, 0.15)",
  colorDanger: "#ef4444",
  colorDangerSoft: "rgba(239, 68, 68, 0.15)",
  radius: 12,
  radiusSmall: 8,
  radiusPill: 999,
  shadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
  shadowSoft: "0 2px 8px rgba(0, 0, 0, 0.2)"
};

export const lightTokens: TokenSet = {
  colorPage: "#f8f8fb",
  colorSurface: "#ffffff",
  colorSurfaceMuted: "#f0f0f5",
  colorSurfaceRaised: "#f5f5fa",
  colorSurfaceAccent: "rgba(124, 58, 237, 0.06)",
  colorBorder: "#e0e0e8",
  colorBorderStrong: "#c8c8d4",
  colorText: "#1a1a2e",
  colorTextSubtle: "#5a5a70",
  colorMuted: "#8888a0",
  colorAccent: "#7c3aed",
  colorAccentStrong: "#6d28d9",
  colorAccentSoft: "rgba(124, 58, 237, 0.1)",
  colorSecondaryAccent: "#8C55FF",
  colorSecondaryAccentSoft: "rgba(140, 85, 255, 0.1)",
  colorSuccess: "#10b981",
  colorSuccessSoft: "rgba(16, 185, 129, 0.1)",
  colorWarning: "#f59e0b",
  colorWarningSoft: "rgba(245, 158, 11, 0.1)",
  colorDanger: "#ef4444",
  colorDangerSoft: "rgba(239, 68, 68, 0.1)",
  radius: 12,
  radiusSmall: 8,
  radiusPill: 999,
  shadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
  shadowSoft: "0 2px 8px rgba(0, 0, 0, 0.05)"
};

export function getTokens(mode: ThemeMode): TokenSet {
  return mode === 'light' ? lightTokens : darkTokens;
}

/** @deprecated Use getTokens(themeMode) or useTokens() hook instead */
export const aiWebComponentTokens: TokenSet = darkTokens;
