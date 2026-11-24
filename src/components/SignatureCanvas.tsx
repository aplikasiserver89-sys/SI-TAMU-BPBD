import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, PenLine } from 'lucide-react';

interface SignatureCanvasProps {
  onSignatureChange: (dataUrl: string) => void;
  hasError?: boolean;
  resetSignal?: number;
}

export function SignatureCanvas({
  onSignatureChange,
  hasError = false,
  resetSignal = 0,
}: SignatureCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasDrawnRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  const initCanvasSurface = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width));
    const height = 180;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F294A';
    ctx.lineWidth = 2.4;

    hasDrawnRef.current = false;
    setHasStroke(false);
    onSignatureChange('');
  }, [onSignatureChange]);

  useEffect(() => {
    initCanvasSurface();
  }, [initCanvasSurface, resetSignal]);

  useEffect(() => {
    const handleResize = () => {
      if (!hasDrawnRef.current) {
        initCanvasSurface();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [initCanvasSurface]);

  const getPointerPosition = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const point = getPointerPosition(e);
    isDrawingRef.current = true;
    lastPointRef.current = point;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#0F294A';
    ctx.fill();
    hasDrawnRef.current = true;
    setHasStroke(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const last = lastPointRef.current;
    if (!canvas || !ctx || !last) return;

    const current = getPointerPosition(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    const midX = (last.x + current.x) / 2;
    const midY = (last.y + current.y) / 2;
    ctx.quadraticCurveTo(last.x, last.y, midX, midY);
    ctx.lineTo(current.x, current.y);
    ctx.strokeStyle = '#0F294A';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    lastPointRef.current = current;
  };

  const finishStroke = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas && hasDrawnRef.current) {
      onSignatureChange(canvas.toDataURL('image/png'));
    }
  };

  const handleClear = () => {
    initCanvasSurface();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-slate-500">
          Gunakan jari atau mouse untuk membubuhkan tanda tangan pada area di bawah
        </span>
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C]"
        >
          <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Hapus TTD</span>
        </button>
      </div>

      <div
        ref={containerRef}
        className={`relative rounded-xl border bg-white overflow-hidden transition-colors ${
          hasError
            ? 'border-red-500 ring-2 ring-red-100'
            : 'border-slate-300 focus-within:border-[#0F294A]'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="block w-full h-[180px] touch-none cursor-crosshair select-none"
          aria-label="Kanvas Tanda Tangan Digital"
        />

        {!hasStroke && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-1.5">
            <PenLine className="w-5 h-5 text-slate-300" aria-hidden="true" />
            <span className="text-xs font-medium">Tanda tangan di area ini</span>
          </div>
        )}

        <div
          className="pointer-events-none absolute bottom-5 left-6 right-6 border-b border-dashed border-slate-200"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
