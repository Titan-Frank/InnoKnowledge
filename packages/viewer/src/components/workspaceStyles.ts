import type { CSSProperties } from 'react';
import type { TokenSet } from './aiwc/styles/tokens.js';

export function createWorkspaceDockStyle(t: TokenSet): CSSProperties {
  return {
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 26,
    background: `linear-gradient(180deg, ${t.colorSurface} 0%, ${t.colorSurfaceRaised} 100%)`,
    boxShadow: t.shadow,
    backdropFilter: 'blur(14px)',
    height: 'calc(100vh - 112px)',
    overflowX: 'hidden',
    overflowY: 'auto',
  };
}

export const workspacePanelContentStyle = {
  display: 'grid',
  gap: 14,
  padding: 16,
  overflowX: 'hidden',
  wordBreak: 'break-word',
} satisfies CSSProperties;

export function createWorkspaceSectionStyle(t: TokenSet): CSSProperties {
  return {
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 20,
    boxShadow: t.shadowSoft,
    padding: '16px 16px 15px',
    display: 'grid',
    gap: 12,
  };
}

export const workspaceSectionHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
} satisfies CSSProperties;

export function createWorkspaceSectionTitleStyle(t: TokenSet): CSSProperties {
  return {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 700,
    color: t.colorText,
  };
}

export function createWorkspaceSectionNoteStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorMuted,
    fontSize: '0.8rem',
  };
}

export const workspaceFieldStyle = {
  display: 'grid',
  gap: 8,
} satisfies CSSProperties;

export function createWorkspaceFieldLabelStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorMuted,
    fontSize: '0.88rem',
    fontWeight: 500,
  };
}

export function createWorkspaceSelectLikeStyle(t: TokenSet): CSSProperties {
  return {
    width: '100%',
    minHeight: 44,
    padding: '0 14px',
    border: `1px solid ${t.colorBorderStrong}`,
    borderRadius: 14,
    background: t.colorSurfaceMuted,
    color: t.colorText,
    fontSize: '0.96rem',
    fontFamily: 'inherit',
  };
}

export function createWorkspaceHintStyle(t: TokenSet): CSSProperties {
  return {
    margin: 0,
    color: t.colorMuted,
    fontSize: '0.84rem',
    lineHeight: 1.65,
  };
}

export function createWorkspaceToggleStyle(t: TokenSet): CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    color: t.colorMuted,
    fontSize: '0.88rem',
    lineHeight: 1.6,
  };
}

export function createDetailSectionStyle(t: TokenSet): CSSProperties {
  return {
    background: t.colorSurface,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 20,
    boxShadow: t.shadowSoft,
    padding: '16px 16px 15px',
    display: 'grid',
    gap: 10,
  };
}

export const detailSectionHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
} satisfies CSSProperties;

export function createDetailSectionTitleStyle(t: TokenSet): CSSProperties {
  return {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 700,
    color: t.colorText,
  };
}

export function createDetailSectionMetaStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorMuted,
    fontSize: '0.82rem',
  };
}

export function createDetailSubcardStyle(t: TokenSet): CSSProperties {
  return {
    borderColor: t.colorBorder,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 16,
    background: t.colorSurfaceMuted,
    padding: 13,
  };
}

export function createDetailEmptyCardStyle(t: TokenSet): CSSProperties {
  return {
    borderColor: t.colorBorder,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 16,
    background: t.colorSurfaceMuted,
    padding: 13,
  };
}

export function createDetailBodyTextStyle(t: TokenSet): CSSProperties {
  return {
    margin: 0,
    color: t.colorTextSubtle,
    fontSize: '0.9rem',
    lineHeight: 1.68,
  };
}
