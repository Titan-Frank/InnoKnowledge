import type { CSSProperties } from 'react';
import { aiWebComponentTokens } from './aiwc/index.js';

export const workspaceDockStyle = {
  position: 'sticky',
  top: 20,
  maxHeight: 'calc(100vh - 52px)',
  overflow: 'auto',
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(16,16,24,0.96) 0%, rgba(10,10,16,0.96) 100%)',
  boxShadow: aiWebComponentTokens.shadow,
  backdropFilter: 'blur(10px)',
} satisfies CSSProperties;

export const workspacePanelContentStyle = {
  display: 'grid',
  gap: 14,
  padding: 14,
} satisfies CSSProperties;

export const workspaceSectionStyle = {
  background: 'rgba(22,22,31,0.92)',
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 18,
  boxShadow: aiWebComponentTokens.shadowSoft,
  padding: '14px 16px',
  display: 'grid',
  gap: 12,
} satisfies CSSProperties;

export const workspaceSectionHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
} satisfies CSSProperties;

export const workspaceSectionTitleStyle = {
  margin: 0,
  fontSize: '1.02rem',
  fontWeight: 600,
  color: aiWebComponentTokens.colorText,
} satisfies CSSProperties;

export const workspaceSectionNoteStyle = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.82rem',
} satisfies CSSProperties;

export const workspaceFieldStyle = {
  display: 'grid',
  gap: 8,
} satisfies CSSProperties;

export const workspaceFieldLabelStyle = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  fontWeight: 500,
} satisfies CSSProperties;

export const workspaceSelectLikeStyle = {
  width: '100%',
  minHeight: 42,
  padding: '0 14px',
  border: `1px solid ${aiWebComponentTokens.colorBorderStrong}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurface,
  color: aiWebComponentTokens.colorText,
  fontSize: '0.96rem',
  fontFamily: 'inherit',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
} satisfies CSSProperties;

export const workspaceHintStyle = {
  margin: 0,
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.84rem',
  lineHeight: 1.65,
} satisfies CSSProperties;

export const workspaceToggleStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  lineHeight: 1.6,
} satisfies CSSProperties;

export const detailSectionStyle = {
  background: 'rgba(22,22,31,0.9)',
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 18,
  boxShadow: aiWebComponentTokens.shadowSoft,
  padding: '14px 16px',
  display: 'grid',
  gap: 10,
} satisfies CSSProperties;

export const detailSectionHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
} satisfies CSSProperties;

export const detailSectionTitleStyle = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 700,
  color: aiWebComponentTokens.colorText,
} satisfies CSSProperties;

export const detailSectionMetaStyle = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.82rem',
} satisfies CSSProperties;

export const detailSubcardStyle = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 14,
  background: 'rgba(16,16,24,0.78)',
  padding: 12,
} satisfies CSSProperties;

export const detailEmptyCardStyle = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 14,
  background: aiWebComponentTokens.colorSurfaceMuted,
  padding: 12,
} satisfies CSSProperties;

export const detailBodyTextStyle = {
  margin: 0,
  color: aiWebComponentTokens.colorTextSubtle,
  fontSize: '0.9rem',
  lineHeight: 1.68,
} satisfies CSSProperties;
