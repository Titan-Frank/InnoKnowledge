import type { ReactNode } from "react";
import {
  createStateCardStyle,
  type PanelTone
} from "../styles/panelStyles";
import { useTokens } from "../../../hooks/useTokens.js";

export type PanelStateBlockProps = {
  tone?: PanelTone;
  visual?: ReactNode;
  title?: ReactNode;
  description: ReactNode;
  action?: ReactNode;
};

export function PanelStateBlock({
  tone = "neutral",
  visual,
  title,
  description,
  action
}: PanelStateBlockProps) {
  const t = useTokens();
  return (
    <div style={createStateCardStyle(tone, t)}>
      {visual ? <div>{visual}</div> : null}
      {title ? (
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>
          {title}
        </div>
      ) : null}
      <div style={{ lineHeight: 1.6 }}>{description}</div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
