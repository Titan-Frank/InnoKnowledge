import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type { Attributes } from 'graphology-types';
import type { ThemeMode } from './aiwc/styles/tokens.js';

// Background RGB values for dimming calculation
const DARK_BG = { r: 10, g: 10, b: 16 };    // #0a0a10
const LIGHT_BG = { r: 248, g: 248, b: 251 }; // #f8f8fb

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
    const match = hex.match(/(\d+)/g);
    if (match && match.length >= 3) {
      return { r: +match[0], g: +match[1], b: +match[2] };
    }
  }
  const cleaned = hex.replace('#', '');
  const full = cleaned.length === 3
    ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2]
    : cleaned;
  return {
    r: parseInt(full.substring(0, 2), 16),
    g: parseInt(full.substring(2, 4), 16),
    b: parseInt(full.substring(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map(v => {
    const h = clamp(v).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

/** Dim a color by mixing it toward the background */
export function dimColor(hex: string, amount: number, mode: ThemeMode = 'dark'): string {
  const bg = mode === 'light' ? LIGHT_BG : DARK_BG;
  const rgb = hexToRgb(hex);
  return rgbToHex(
    bg.r + (rgb.r - bg.r) * amount,
    bg.g + (rgb.g - bg.g) * amount,
    bg.b + (rgb.b - bg.b) * amount,
  );
}

/** Brighten a color (push toward white) */
export function brightenColor(hex: string, factor: number, _mode: ThemeMode = 'dark'): string {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb.r + ((255 - rgb.r) * (factor - 1)) / factor,
    rgb.g + ((255 - rgb.g) * (factor - 1)) / factor,
    rgb.b + ((255 - rgb.b) * (factor - 1)) / factor,
  );
}

/** Create a theme-aware drawNodeHover function for Sigma.js */
export function createDrawNodeHover(mode: ThemeMode) {
  const tooltipBg = mode === 'light' ? '#ffffff' : '#12121c';
  const tooltipBorder = mode === 'light' ? '#e0e0e8' : undefined; // only light uses border
  const labelColor = mode === 'light' ? '#1a1a2e' : '#f5f5f7';

  return function drawNodeHover(
    context: CanvasRenderingContext2D,
    data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
    _settings: Settings<Attributes, Attributes, Attributes>,
  ): void {
    const { x, y, size, color, label } = data;

    // Glow ring around the node
    context.beginPath();
    context.arc(x, y, size + 4, 0, Math.PI * 2);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.globalAlpha = 0.5;
    context.stroke();
    context.globalAlpha = 1;

    // Tooltip pill above node
    if (label) {
      const pillHeight = 24;
      const padding = 10;
      context.font = "500 11px 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', monospace";
      const textWidth = context.measureText(label).width;
      const pillWidth = textWidth + padding * 2;
      const pillX = x - pillWidth / 2;
      const pillY = y - size - pillHeight - 10;

      // Background pill
      context.fillStyle = tooltipBg;
      context.beginPath();
      context.roundRect(pillX, pillY, pillWidth, pillHeight, 6);
      context.fill();

      // Colored border (always the node color in dark, subtle in light)
      context.strokeStyle = tooltipBorder ?? color;
      context.lineWidth = tooltipBorder ? 1 : 2;
      context.beginPath();
      context.roundRect(pillX, pillY, pillWidth, pillHeight, 6);
      context.stroke();

      // Label text
      context.fillStyle = labelColor;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, x, pillY + pillHeight / 2);
    }
  };
}

/** @deprecated Use createDrawNodeHover(mode) instead */
export const drawNodeHover = createDrawNodeHover('dark');
