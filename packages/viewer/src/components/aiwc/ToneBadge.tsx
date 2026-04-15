import type { ReactNode } from "react";
import { createToneBadgeStyle, type PanelTone } from "./styles/panelStyles";
import { useTokens } from "../../hooks/useTokens.js";

export type ToneBadgeProps = {
  tone?: PanelTone;
  children: ReactNode;
};

export function ToneBadge({ tone = "neutral", children }: ToneBadgeProps) {
  const t = useTokens();
  return <span style={createToneBadgeStyle(tone, t)}>{children}</span>;
}
