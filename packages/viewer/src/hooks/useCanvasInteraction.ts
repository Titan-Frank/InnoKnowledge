import { useEffect } from 'react';
import type React from 'react';
import { onPointerDown, onPointerMove, onPointerUp, onWheel } from '../graph/interaction.js';

export function useCanvasInteraction(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handlePointerDown = (e: PointerEvent) => onPointerDown(e, canvas);
    const handlePointerMove = (e: PointerEvent) => onPointerMove(e, canvas);
    const handlePointerUp = (e: PointerEvent) => onPointerUp(e, canvas);
    const handleWheel = (e: WheelEvent) => onWheel(e);

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [canvasRef]);
}
