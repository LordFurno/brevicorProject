import { useState, useRef, useCallback, useEffect } from 'react';
import type { NormalizedRect } from '../types';

interface VideoRoiSelectorProps {
  onSelectionChange: (rect: NormalizedRect | null) => void;
  selectedRect: NormalizedRect | null;
  children: React.ReactNode;
}

export function VideoRoiSelector({
  onSelectionChange,
  selectedRect,
  children,
}: VideoRoiSelectorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Convert mouse event coordinates into relative 0..1 coordinates
  const getRelativeCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) {
      return {
        xPixel: 0,
        yPixel: 0,
        xNorm: 0,
        yNorm: 0,
        containerWidth: 1,
        containerHeight: 1,
      };
    }
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    return {
      xPixel: x,
      yPixel: y,
      xNorm: x / rect.width,
      yNorm: y / rect.height,
      containerWidth: rect.width,
      containerHeight: rect.height,
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Left-click only
    if (e.button !== 0) return;
    const { xPixel, yPixel } = getRelativeCoords(e);
    setIsDrawing(true);
    setStartPoint({ x: xPixel, y: yPixel });
    setCurrentBox({ x: xPixel, y: yPixel, w: 0, h: 0 });
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDrawing || !startPoint || !containerRef.current) return;
      const { xPixel, yPixel } = getRelativeCoords(e);

      const x = Math.min(startPoint.x, xPixel);
      const y = Math.min(startPoint.y, yPixel);
      const w = Math.abs(xPixel - startPoint.x);
      const h = Math.abs(yPixel - startPoint.y);

      setCurrentBox({ x, y, w, h });
    },
    [isDrawing, startPoint, getRelativeCoords]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!isDrawing || !startPoint || !containerRef.current) return;
      setIsDrawing(false);

      const rect = containerRef.current.getBoundingClientRect();
      const { xPixel, yPixel } = getRelativeCoords(e);

      const pxW = Math.abs(xPixel - startPoint.x);
      const pxH = Math.abs(yPixel - startPoint.y);

      // Require at least a 20x20 pixel drag to register as a region
      if (pxW > 20 && pxH > 20) {
        const minX = Math.min(startPoint.x, xPixel);
        const minY = Math.min(startPoint.y, yPixel);
        const normRect: NormalizedRect = {
          x: minX / rect.width,
          y: minY / rect.height,
          width: pxW / rect.width,
          height: pxH / rect.height,
        };
        onSelectionChange(normRect);
      } else {
        // Trivial click clears selection
        onSelectionChange(null);
        setCurrentBox(null);
      }
      setStartPoint(null);
    },
    [isDrawing, startPoint, getRelativeCoords, onSelectionChange]
  );

  useEffect(() => {
    if (isDrawing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDrawing, handleMouseMove, handleMouseUp]);

  const hasSelection = Boolean(isDrawing ? (currentBox && currentBox.w > 20 && currentBox.h > 20) : selectedRect);

  const boxStyles: React.CSSProperties = isDrawing && currentBox
    ? {
        position: 'absolute',
        left: `${currentBox.x}px`,
        top: `${currentBox.y}px`,
        width: `${currentBox.w}px`,
        height: `${currentBox.h}px`,
      }
    : selectedRect
    ? {
        position: 'absolute',
        left: `${selectedRect.x * 100}%`,
        top: `${selectedRect.y * 100}%`,
        width: `${selectedRect.width * 100}%`,
        height: `${selectedRect.height * 100}%`,
      }
    : {};

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: 'crosshair',
        userSelect: 'none',
      }}
    >
      {/* Video Content */}
      {children}

      {/* Dim overlay outside the selected region when selected */}
      {hasSelection && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 15,
          }}
        >
          {/* Active Selection Box */}
          <div
            style={{
              ...boxStyles,
              border: '2px solid #38bdf8',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4), 0 0 15px rgba(56, 189, 248, 0.7)',
              borderRadius: '4px',
              pointerEvents: 'none',
            }}
          >
            {/* Corner reticle handles */}
            <div style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, background: '#38bdf8', borderRadius: 2 }} />
            <div style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, background: '#38bdf8', borderRadius: 2 }} />
            <div style={{ position: 'absolute', bottom: -4, left: -4, width: 8, height: 8, background: '#38bdf8', borderRadius: 2 }} />
            <div style={{ position: 'absolute', bottom: -4, right: -4, width: 8, height: 8, background: '#38bdf8', borderRadius: 2 }} />

            {/* Dimension Tag */}
            <div
              style={{
                position: 'absolute',
                top: -26,
                left: 0,
                backgroundColor: '#0284c7',
                color: '#ffffff',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                letterSpacing: '0.03em',
                boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
              }}
            >
              🎯 ROI SELECTED
            </div>
          </div>
        </div>
      )}

      {/* Helper instruction tooltip if no selection yet */}
      {!hasSelection && !isDrawing && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(6px)',
            color: '#94a3b8',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '0.75rem',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            pointerEvents: 'none',
            zIndex: 12,
          }}
        >
          💡 Tip: Click & drag anywhere on video to select custom lesion crop area
        </div>
      )}
    </div>
  );
}
