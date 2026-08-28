export type FittingFontSizeOptions = {
  min: number;
  max: number;
  precision?: number;
  fits: (fontSize: number) => boolean;
};

export function largestFittingFontSize({
  min,
  max,
  precision = 0.1,
  fits,
}: FittingFontSizeOptions): number {
  const lowerBound = Math.max(0, Math.min(min, max));
  const upperBound = Math.max(lowerBound, max);
  const step = Math.max(0.01, precision);

  if (!fits(lowerBound)) return lowerBound;
  if (fits(upperBound)) return upperBound;

  let low = lowerBound;
  let high = upperBound;
  while (high - low > step) {
    const candidate = (low + high) / 2;
    if (fits(candidate)) low = candidate;
    else high = candidate;
  }

  return Math.floor(low / step) * step;
}
