import { useEffect, useRef, useState, useCallback } from 'react';
import {
  X, Pencil, Circle, Square, ArrowRight, Type, Undo2, Download, Check,
  Minus, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ── Types ─────────────────────────────────────── */

type Tool = 'pen' | 'circle' | 'rect' | 'arrow' | 'text';
type DrawAction = {
  tool: Tool;
  color: string;
  lineWidth: number;
  points?: { x: number; y: number }[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  text?: string;
};

interface ImageAnnotatorProps {
  imageUrl: string;
  imageName: string;
  onSave: (annotatedBase64: string) => void;
  onClose: () => void;
}

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff', '#000000'];

const TOOLS: { key: Tool; icon: typeof Pencil; label: string }[] = [
  { key: 'pen', icon: Pencil, label: 'Draw' },
  { key: 'arrow', icon: ArrowRight, label: 'Arrow' },
  { key: 'circle', icon: Circle, label: 'Circle' },
  { key: 'rect', icon: Square, label: 'Rectangle' },
  { key: 'text', icon: Type, label: 'Text' },
];

/* ── Component ─────────────────────────────────── */

export function ImageAnnotator({ imageUrl, imageName, onSave, onClose }: ImageAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(3);
  const [actions, setActions] = useState<DrawAction[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentAction, setCurrentAction] = useState<DrawAction | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      // Fit image to viewport (max 85vh, 90vw)
      const maxW = window.innerWidth * 0.88;
      const maxH = window.innerHeight * 0.78;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      setCanvasSize({ w, h });
      setImageLoaded(true);
    };
    img.onerror = () => {
      // Can't load image (expired URL)
      setImageLoaded(false);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Redraw canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imageRef.current;
    if (!canvas || !ctx || !img) return;

    // Draw base image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw all saved actions
    const allActions = currentAction ? [...actions, currentAction] : actions;
    for (const action of allActions) {
      ctx.strokeStyle = action.color;
      ctx.fillStyle = action.color;
      ctx.lineWidth = action.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      switch (action.tool) {
        case 'pen':
          if (action.points && action.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(action.points[0].x, action.points[0].y);
            for (let i = 1; i < action.points.length; i++) {
              ctx.lineTo(action.points[i].x, action.points[i].y);
            }
            ctx.stroke();
          }
          break;

        case 'circle':
          if (action.start && action.end) {
            const cx = (action.start.x + action.end.x) / 2;
            const cy = (action.start.y + action.end.y) / 2;
            const rx = Math.abs(action.end.x - action.start.x) / 2;
            const ry = Math.abs(action.end.y - action.start.y) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;

        case 'rect':
          if (action.start && action.end) {
            ctx.beginPath();
            ctx.strokeRect(
              action.start.x, action.start.y,
              action.end.x - action.start.x,
              action.end.y - action.start.y,
            );
          }
          break;

        case 'arrow':
          if (action.start && action.end) {
            const { start, end } = action;
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const headLen = 12 + action.lineWidth * 2;

            // Line
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();

            // Arrowhead
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(
              end.x - headLen * Math.cos(angle - Math.PI / 6),
              end.y - headLen * Math.sin(angle - Math.PI / 6),
            );
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(
              end.x - headLen * Math.cos(angle + Math.PI / 6),
              end.y - headLen * Math.sin(angle + Math.PI / 6),
            );
            ctx.stroke();
          }
          break;

        case 'text':
          if (action.start && action.text) {
            ctx.font = `${14 + action.lineWidth * 2}px Inter, sans-serif`;
            ctx.fillStyle = action.color;
            // Background
            const metrics = ctx.measureText(action.text);
            const fontSize = 14 + action.lineWidth * 2;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(
              action.start.x - 2,
              action.start.y - fontSize,
              metrics.width + 6,
              fontSize + 4,
            );
            ctx.fillStyle = action.color;
            ctx.fillText(action.text, action.start.x, action.start.y);
          }
          break;
      }
    }
  }, [actions, currentAction]);

  useEffect(() => {
    if (imageLoaded) redraw();
  }, [imageLoaded, redraw]);

  // Get canvas-relative coords
  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (tool === 'text') {
      const pos = getPos(e);
      setTextPos(pos);
      return;
    }
    setIsDrawing(true);
    const pos = getPos(e);
    if (tool === 'pen') {
      setCurrentAction({ tool, color, lineWidth, points: [pos] });
    } else {
      setCurrentAction({ tool, color, lineWidth, start: pos, end: pos });
    }
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !currentAction) return;
    e.preventDefault();
    const pos = getPos(e);
    if (tool === 'pen') {
      setCurrentAction((prev) =>
        prev ? { ...prev, points: [...(prev.points || []), pos] } : prev,
      );
    } else {
      setCurrentAction((prev) =>
        prev ? { ...prev, end: pos } : prev,
      );
    }
    redraw();
  };

  const handleEnd = () => {
    if (!isDrawing || !currentAction) return;
    setIsDrawing(false);
    setActions((prev) => [...prev, currentAction]);
    setCurrentAction(null);
  };

  const handleTextSubmit = () => {
    if (textPos && textInput.trim()) {
      setActions((prev) => [
        ...prev,
        { tool: 'text', color, lineWidth, start: textPos, text: textInput.trim() },
      ]);
      setTextInput('');
      setTextPos(null);
    }
  };

  const handleUndo = () => {
    setActions((prev) => prev.slice(0, -1));
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Export as JPEG (smaller than PNG for photos)
    const base64 = canvas.toDataURL('image/jpeg', 0.85);
    onSave(base64);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `annotated-${imageName}`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (!imageLoaded) {
    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="text-center text-white">
          <div className="h-6 w-6 rounded-full border-2 border-white border-t-transparent animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading image…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-black/90 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1a1a1a] border-b border-[#333] shrink-0">
        {/* Left: Tools */}
        <div className="flex items-center gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTool(t.key)}
              title={t.label}
              className={cn(
                'flex items-center justify-center rounded-lg p-2 transition-colors',
                tool === t.key
                  ? 'bg-accent text-black'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <t.icon size={18} />
            </button>
          ))}

          {/* Separator */}
          <div className="w-px h-6 bg-white/20 mx-1" />

          {/* Colors */}
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                'h-6 w-6 rounded-full border-2 transition-transform',
                color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105',
              )}
              style={{ backgroundColor: c }}
            />
          ))}

          {/* Separator */}
          <div className="w-px h-6 bg-white/20 mx-1" />

          {/* Line width */}
          <button
            onClick={() => setLineWidth(Math.max(1, lineWidth - 1))}
            className="text-white/60 hover:text-white p-1"
          >
            <Minus size={14} />
          </button>
          <span className="text-white/80 text-xs font-mono w-4 text-center">{lineWidth}</span>
          <button
            onClick={() => setLineWidth(Math.min(10, lineWidth + 1))}
            className="text-white/60 hover:text-white p-1"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUndo}
            disabled={actions.length === 0}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors"
          >
            <Undo2 size={14} />
            Undo
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Download size={14} />
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-400 transition-colors"
          >
            <Check size={14} />
            Save
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors ml-1"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden p-4"
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          className="rounded-lg shadow-2xl cursor-crosshair touch-none"
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
      </div>

      {/* Text input overlay */}
      {textPos && (
        <div
          className="fixed z-[310] flex items-center gap-1"
          style={{
            left: '50%',
            bottom: '80px',
            transform: 'translateX(-50%)',
          }}
        >
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTextSubmit();
              if (e.key === 'Escape') { setTextPos(null); setTextInput(''); }
            }}
            placeholder="Type text, press Enter"
            autoFocus
            className="rounded-lg border border-white/20 bg-black/80 px-3 py-2 text-sm text-white outline-none focus:border-accent min-w-[200px]"
          />
          <button
            onClick={handleTextSubmit}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-black"
          >
            Add
          </button>
          <button
            onClick={() => { setTextPos(null); setTextInput(''); }}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default ImageAnnotator;
