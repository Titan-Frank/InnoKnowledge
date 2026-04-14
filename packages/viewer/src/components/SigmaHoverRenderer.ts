import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type { Attributes } from 'graphology-types';

// Dark background color for dimming calculation
const DARK_BG = { r: 10, g: 10, b: 16 }; // #0a0a10

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

/** Dim a color by mixing it toward the dark background */
export function dimColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    DARK_BG.r + (rgb.r - DARK_BG.r) * amount,
    DARK_BG.g + (rgb.g - DARK_BG.g) * amount,
    DARK_BG.b + (rgb.b - DARK_BG.b) * amount,
  );
}

/** Brighten a color (push toward white) */
export function brightenColor(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb.r + ((255 - rgb.r) * (factor - 1)) / factor,
    rgb.g + ((255 - rgb.g) * (factor - 1)) / factor,
    rgb.b + ((255 - rgb.b) * (factor - 1)) / factor,
  );
}

export function drawNodeHover(
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

  // Tooltip pill above node (dark background, matching GitNexus style)
  if (label) {
    const pillHeight = 24;
    const padding = 10;
    context.font = "500 11px 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', monospace";
    const textWidth = context.measureText(label).width;
    const pillWidth = textWidth + padding * 2;
    const pillX = x - pillWidth / 2;
    const pillY = y - size - pillHeight - 10;

    // Dark background pill
    context.fillStyle = '#12121c';
    context.beginPath();
    context.roundRect(pillX, pillY, pillWidth, pillHeight, 6);
    context.fill();

    // Colored border
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(pillX, pillY, pillWidth, pillHeight, 6);
    context.stroke();

    // Label text - light color
    context.fillStyle = '#f5f5f7';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, x, pillY + pillHeight / 2);
  }
}
