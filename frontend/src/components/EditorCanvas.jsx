import { useEffect, useRef } from "react";
import { clampPercent } from "../utils/geometry";

export default function EditorCanvas({
  lot,
  onLotChange,
  onSelectSpace,
  selectedSpaceId,
}) {
  const canvasRef = useRef(null);
  const interactionRef = useRef(null);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!interactionRef.current) {
        return;
      }

      const { action, rect, spaceId, startX, startY, snapshot } = interactionRef.current;
      const deltaX = ((event.clientX - startX) / rect.width) * 100;
      const deltaY = ((event.clientY - startY) / rect.height) * 100;

      onLotChange((currentLot) => ({
        ...currentLot,
        spaces: currentLot.spaces.map((space) => {
          if (space.id !== spaceId) {
            return space;
          }

          if (action === "move") {
            return {
              ...space,
              x: clampPercent(snapshot.x + deltaX, 0, 100 - space.width),
              y: clampPercent(snapshot.y + deltaY, 0, 100 - space.height),
            };
          }

          return {
            ...space,
            width: clampPercent(snapshot.width + deltaX, 4, 40),
            height: clampPercent(snapshot.height + deltaY, 4, 40),
          };
        }),
      }));
    };

    const handlePointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onLotChange]);

  const beginInteraction = (event, space, action) => {
    event.stopPropagation();
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    onSelectSpace(space.id);
    interactionRef.current = {
      action,
      rect,
      spaceId: space.id,
      startX: event.clientX,
      startY: event.clientY,
      snapshot: {
        x: space.x,
        y: space.y,
        width: space.width,
        height: space.height,
      },
    };
  };
  return (
    <div className="editor-canvas" onClick={() => onSelectSpace(null)} ref={canvasRef}>
      {lot.backgroundImage ? (
        <img alt={`${lot.name} background`} className="editor-background" src={lot.backgroundImage} />
      ) : (
        <div className="editor-placeholder">
          <h3>Drop in a layout image or start with a blank canvas</h3>
          <p>Spaces can be dragged and resized directly on the board.</p>
        </div>
      )}

      <div className="editor-overlay">
        {lot.spaces.map((space) => (
          <button
            className={`parking-space parking-space--editor ${
              selectedSpaceId === space.id ? "parking-space--selected" : ""
            }`}
            key={space.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelectSpace(space.id);
            }}
            onPointerDown={(event) => beginInteraction(event, space, "move")}
            style={{
              left: `${space.x}%`,
              top: `${space.y}%`,
              width: `${space.width}%`,
              height: `${space.height}%`,
              transform: `rotate(${space.rotation}deg)`,
            }}
            type="button"
          >
            <span>{space.label}</span>
            <span
              className="resize-handle"
              onPointerDown={(event) => beginInteraction(event, space, "resize")}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
