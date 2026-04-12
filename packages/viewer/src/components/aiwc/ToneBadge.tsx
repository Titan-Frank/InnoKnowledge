import type { ReactNode } from "react";
import { createToneBadgeStyle, type PanelTone } from "./styles/panelStyles";

export type ToneBadgeProps = {
  tone?: PanelTone;
  children: ReactNode;
};

export function ToneBadge({ tone = "neutral", children }: ToneBadgeProps) {
  return <span style={createToneBadgeStyle(tone)}>{children}</span>;
}
