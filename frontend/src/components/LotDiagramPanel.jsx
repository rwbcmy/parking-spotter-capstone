import { useMemo } from "react";

import LotDesignSurface from "./LotDesignSurface";

export default function LotDiagramPanel({ lot, onClose }) {
  const canvasWidth = Number(lot.canvas?.width) || 1000;
  const canvasHeight = Number(lot.canvas?.height) || 600;
  const diagramViewport = useMemo(() => {
    if (!lot.spaces.length) {
      return {
        left: 0,
        top: 0,
      };
    }

    const minX = Math.min(...lot.spaces.map((space) => Number(space.x) || 0));
    const minY = Math.min(...lot.spaces.map((space) => Number(space.y) || 0));
    const maxX = Math.max(...lot.spaces.map((space) => (Number(space.x) || 0) + (Number(space.width) || 0)));
    const maxY = Math.max(...lot.spaces.map((space) => (Number(space.y) || 0) + (Number(space.height) || 0)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const desiredLeft = 50 - centerX;
    const desiredTop = 50 - centerY;
    const minLeft = -minX;
    const maxLeft = 100 - maxX;
    const minTop = -minY;
    const maxTop = 100 - maxY;

    return {
      left: Math.min(Math.max(desiredLeft, minLeft), maxLeft),
      top: Math.min(Math.max(desiredTop, minTop), maxTop),
    };
  }, [lot.spaces]);

  const diagramTransform = {
    left: `${diagramViewport.left}%`,
    top: `${diagramViewport.top}%`,
    width: "100%",
    height: "100%",
  };

  return (
    <aside className="diagram-panel diagram-panel--popup">
      <div
        className="diagram-canvas diagram-canvas--compact"
        style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
      >
        <div className="diagram-canvas__hud">
          <div className="diagram-canvas__counts">
            <span className="diagram-canvas__count diagram-canvas__count--open">{lot.metrics.open}</span>
            <span className="diagram-canvas__count diagram-canvas__count--occupied">{lot.metrics.occupied}</span>
            <span className="diagram-canvas__count diagram-canvas__count--unknown">{lot.metrics.unknown}</span>
          </div>
          <button aria-label="Close" className="diagram-canvas__close" onClick={onClose} type="button">
            X
          </button>
        </div>
        <div className="diagram-viewport" style={diagramTransform}>
          <LotDesignSurface compact label={`${lot.name} parking diagram`} />
          <div className="diagram-overlay">
            {lot.spaces.map((space) => (
              <div
                className={`diagram-space diagram-space--${space.status} diagram-space--popup`}
                key={space.id}
                style={{
                  left: `${space.x}%`,
                  top: `${space.y}%`,
                  width: `${space.width}%`,
                  height: `${space.height}%`,
                  transform: `rotate(${space.rotation}deg)`,
                }}
              >
                <span>{space.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
