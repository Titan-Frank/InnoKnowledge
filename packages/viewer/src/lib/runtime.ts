const publicArtifactBase = (import.meta.env.VITE_PUBLIC_ARTIFACT_BASE || '')
  .trim()
  .replace(/\/+$/, '');

export const PUBLIC_ARTIFACT_BASE = publicArtifactBase;
export const PUBLIC_ARTIFACT_MODE = Boolean(publicArtifactBase);

export function publicArtifactPath(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${PUBLIC_ARTIFACT_BASE}/${normalizedPath}`;
}
