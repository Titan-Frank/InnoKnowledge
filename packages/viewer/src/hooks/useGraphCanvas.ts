import { useRef, useEffect } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { stepSimulation } from '../graph/simulation.js';
import { draw } from '../render/canvas.js';

export function useGraphCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Start simulation + draw loop
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const state = useGraphStore.getState();
      stepSimulation(state);
      const canvas = canvasRef.current;
      if (canvas && state.data) {
        draw(state, canvas);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return { canvasRef, wrapRef };
}
