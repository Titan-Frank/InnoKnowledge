import type { CSSProperties } from 'react';
import type { TokenSet } from './aiwc/styles/tokens.js';

export function createWorkspaceDockStyle(t: TokenSet): CSSProperties {
  return {
    position: 'sticky',
    top: 20,
    maxHeight: 'calc(100vh - 52px)',
    overflow: 'auto',
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 20,
    background: t.colorSurface,
    boxShadow: t.shadow,
    backdropFilter: 'blur(10px)',
  };
}

export const workspacePanelContentStyle = {
  display: 'grid',
  gap: 14,
  padding: 14,
} satisfies CSSProperties;

export function createWorkspaceSectionStyle(t: TokenSet): CSSProperties {
  return {
    background: t.colorSurfaceRaised,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 18,
    boxShadow: t.shadowSoft,
    padding: '14px 16px',
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
    fontSize: '1.02rem',
    fontWeight: 600,
    color: t.colorText,
  };
}

export function createWorkspaceSectionNoteStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorMuted,
    fontSize: '0.82rem',
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
    minHeight: 42,
    padding: '0 14px',
    border: `1px solid ${t.colorBorderStrong}`,
    borderRadius: t.radiusSmall,
    background: t.colorSurface,
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
    background: t.colorSurfaceRaised,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 18,
    boxShadow: t.shadowSoft,
    padding: '14px 16px',
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
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 14,
    background: t.colorSurfaceMuted,
    padding: 12,
  };
}

export function createDetailEmptyCardStyle(t: TokenSet): CSSProperties {
  return {
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 14,
    background: t.colorSurfaceMuted,
    padding: 12,
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
