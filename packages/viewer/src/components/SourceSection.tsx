import { useGraphStore } from '../store/graphStore.js';
import { useSwitchSource } from '../hooks/useBootData.js';
import {
  createWorkspaceFieldLabelStyle,
  workspaceFieldStyle,
  createWorkspaceHintStyle,
  workspaceSectionHeaderStyle,
  createWorkspaceSectionNoteStyle,
  createWorkspaceSectionStyle,
  createWorkspaceSectionTitleStyle,
  createWorkspaceSelectLikeStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

export function SourceSection() {
  const t = useTokens();
  const sourceConfigs = useGraphStore((s) => s.sourceConfigs);
  const selectedSourceKey = useGraphStore((s) => s.selectedSourceKey);
  const sourceLoading = useGraphStore((s) => s.sourceLoading);
  const data = useGraphStore((s) => s.data);
  const switchSource = useSwitchSource();

  const sources = Array.from(sourceConfigs.values());
  const source = sourceConfigs.get(selectedSourceKey || '') || sources[0];
  const warnings = data?.loadWarnings || [];
  const sourceNote = sourceLoading ? '切换中' : source?.label;

  const info: string[] = [];
  if (source?.description) info.push(source.description);
  if (source?.hasProfiles) info.push('含 profiles');
  if (warnings.length > 0) info.push(`警告：${warnings[0]}`);

  return (
    <div style={createWorkspaceSectionStyle(t)}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={createWorkspaceSectionTitleStyle(t)}>数据源</h2>
        <span style={createWorkspaceSectionNoteStyle(t)}>{sourceNote}</span>
      </div>
      <label style={workspaceFieldStyle}>
        <span style={createWorkspaceFieldLabelStyle(t)}>选择版本</span>
        <select
          value={selectedSourceKey || ''}
          disabled={sourceLoading}
          onChange={(e) => switchSource(e.target.value)}
          style={createWorkspaceSelectLikeStyle(t)}
        >
          {sources.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </label>
      <p style={createWorkspaceHintStyle(t)}>{info.join(' | ')}</p>
    </div>
  );
}
