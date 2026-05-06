import { useEffect, useMemo, useRef, useState } from "react";
import { getLotCameraFrameUrl } from "../services/parkingService";
import LotDesignSurface from "./LotDesignSurface";

const DIAGRAM_SPOT_WIDTH = 8;
const DIAGRAM_SPOT_HEIGHT = 24;
const DIAGRAM_VIEW_STORAGE_KEY = "parking-spotter.diagram-view.v1";
const DIAGRAM_ZOOM_MIN = 0.75;
const DIAGRAM_ZOOM_MAX = 2.5;
const DIAGRAM_ZOOM_STEP = 0.25;
const DIAGRAM_PAN_MARGIN = 35;
const DIAGRAM_COORDINATE_MIN = -40;
const DIAGRAM_COORDINATE_MAX = 140;
const CAMERA_FRAME_REFRESH_MS = 400;

function nextSpotLabel(spaces) {
  const nextIndex = spaces.length + 1;
  return `A${nextIndex}`;
}

function polygonPoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return "";
  }

  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function polygonCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const total = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + Number(point.x || 0),
      y: accumulator.y + Number(point.y || 0),
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function getPolygonPointCount(space) {
  return Array.isArray(space?.polygon) ? space.polygon.length : 0;
}

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampDiagramCoordinate(value, size) {
  const resolvedSize = Number(size) || 0;

  return Number(
    clampValue(
      Number(value) || 0,
      DIAGRAM_COORDINATE_MIN,
      DIAGRAM_COORDINATE_MAX - resolvedSize,
    ).toFixed(2),
  );
}

function clampDiagramX(value, width = DIAGRAM_SPOT_WIDTH) {
  return clampDiagramCoordinate(value, width);
}

function clampDiagramY(value, height = DIAGRAM_SPOT_HEIGHT) {
  return clampDiagramCoordinate(value, height);
}

function getDefaultDiagramView(spaces) {
  if (!spaces.length) {
    return {
      zoom: 1,
      left: 0,
      top: 0,
    };
  }

  const minX = Math.min(...spaces.map((space) => Number(space.x) || 0));
  const minY = Math.min(...spaces.map((space) => Number(space.y) || 0));
  const maxX = Math.max(...spaces.map((space) => (Number(space.x) || 0) + (Number(space.width) || 0)));
  const maxY = Math.max(...spaces.map((space) => (Number(space.y) || 0) + (Number(space.height) || 0)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const desiredLeft = 50 - centerX;
  const desiredTop = 50 - centerY;
  const minLeft = -minX;
  const maxLeft = 100 - maxX;
  const minTop = -minY;
  const maxTop = 100 - maxY;
  const spansBeyondCanvasX = maxX - minX > 100;
  const spansBeyondCanvasY = maxY - minY > 100;

  return clampDiagramView({
    zoom: 1,
    left: spansBeyondCanvasX
      ? Number(desiredLeft.toFixed(2))
      : Number(Math.min(Math.max(desiredLeft, minLeft), maxLeft).toFixed(2)),
    top: spansBeyondCanvasY
      ? Number(desiredTop.toFixed(2))
      : Number(Math.min(Math.max(desiredTop, minTop), maxTop).toFixed(2)),
  });
}

function clampDiagramView(view) {
  const zoom = clampValue(Number(view.zoom) || 1, DIAGRAM_ZOOM_MIN, DIAGRAM_ZOOM_MAX);
  const minOffset = DIAGRAM_PAN_MARGIN - zoom * 100;
  const maxOffset = DIAGRAM_PAN_MARGIN;

  return {
    zoom: Number(zoom.toFixed(2)),
    left: Number(clampValue(Number(view.left) || 0, minOffset, maxOffset).toFixed(2)),
    top: Number(clampValue(Number(view.top) || 0, minOffset, maxOffset).toFixed(2)),
  };
}

function readStoredDiagramView(lotId) {
  if (!lotId) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(DIAGRAM_VIEW_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const storedViews = JSON.parse(rawValue);
    if (!storedViews || typeof storedViews !== "object") {
      return null;
    }

    const storedView = storedViews[lotId];
    return storedView ? clampDiagramView(storedView) : null;
  } catch {
    return null;
  }
}

function writeStoredDiagramView(lotId, view) {
  if (!lotId) {
    return;
  }

  try {
    const rawValue = window.localStorage.getItem(DIAGRAM_VIEW_STORAGE_KEY);
    const storedViews = rawValue ? JSON.parse(rawValue) : {};
    const nextStoredViews =
      storedViews && typeof storedViews === "object" ? { ...storedViews } : {};

    nextStoredViews[lotId] = clampDiagramView(view);
    window.localStorage.setItem(DIAGRAM_VIEW_STORAGE_KEY, JSON.stringify(nextStoredViews));
  } catch {
    // Ignore local storage write failures so the editor still works in restricted browsers.
  }
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const updateSize = (width, height) => {
      setSize({
        width: Math.round(width),
        height: Math.round(height),
      });
    };

    updateSize(element.clientWidth, element.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      updateSize(entry.contentRect.width, entry.contentRect.height);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export default function LotLayoutEditor({ lot, onLotChange }) {
  const [selectedSpotId, setSelectedSpotId] = useState(lot.spaces[0]?.id ?? "");
  const [cameraSize, setCameraSize] = useState({ width: 1280, height: 720 });
  const [showVehicleDetections, setShowVehicleDetections] = useState(false);
  const [cameraFrameSrc, setCameraFrameSrc] = useState(() =>
    getLotCameraFrameUrl(
      { backendLotId: lot.backendLotId },
      { showDetections: false },
    ),
  );
  const [isMappingCamera, setIsMappingCamera] = useState(false);
  const [isCameraExpanded, setIsCameraExpanded] = useState(false);
  const [diagramView, setDiagramView] = useState(
    () => readStoredDiagramView(lot.id) ?? getDefaultDiagramView(lot.spaces),
  );
  const diagramFrameRef = useRef(null);
  const diagramCanvasRef = useRef(null);
  const cameraViewportRef = useRef(null);
  const modalCameraViewportRef = useRef(null);
  const dragStateRef = useRef(null);
  const diagramPanStateRef = useRef(null);
  const cameraViewportSize = useElementSize(cameraViewportRef);
  const modalCameraViewportSize = useElementSize(modalCameraViewportRef);
  const effectiveSelectedSpotId = lot.spaces.some((space) => space.id === selectedSpotId)
    ? selectedSpotId
    : (lot.spaces[0]?.id ?? "");
  const selectedSpot = useMemo(
    () => lot.spaces.find((space) => space.id === effectiveSelectedSpotId) ?? lot.spaces[0] ?? null,
    [effectiveSelectedSpotId, lot.spaces],
  );
  const selectedPolygon = useMemo(
    () => (Array.isArray(selectedSpot?.polygon) ? selectedSpot.polygon : []),
    [selectedSpot],
  );
  const selectedPolygonPointCount = selectedPolygon.length;
  const diagramZoomPercent = Math.round(diagramView.zoom * 100);
  const diagramViewportStyle = {
    left: `${diagramView.left}%`,
    top: `${diagramView.top}%`,
    width: `${diagramView.zoom * 100}%`,
    height: `${diagramView.zoom * 100}%`,
  };
  const cameraAspectRatio = cameraSize.height > 0 ? cameraSize.width / cameraSize.height : 16 / 9;
  const resolveViewportFrameWidth = (viewportSize) => {
    const availableWidth = Math.max(viewportSize.width - 16, 0);
    const availableHeight = Math.max(viewportSize.height - 16, 0);
    if (availableWidth <= 0 || availableHeight <= 0) {
      return null;
    }

    return Math.round(Math.min(availableWidth, availableHeight * cameraAspectRatio));
  };
  const editorCameraFrameWidth = resolveViewportFrameWidth(cameraViewportSize);
  const modalCameraFrameWidth = resolveViewportFrameWidth(modalCameraViewportSize);
  const canShowVehicleDetections = Boolean(lot.backendLotId);
  const workflowHelperText = !selectedSpot
    ? "Add or select a spot to start outlining it on the camera."
    : isMappingCamera
      ? "Outlining is on. Click each corner or edge change on the camera image."
      : selectedPolygonPointCount
        ? "Outline saved. Start outlining again if you want to refine the shape."
        : "Start outlining, then click around the spot boundary on the camera image.";

  useEffect(() => {
    let cancelled = false;

    const loadFreshFrame = () => {
      const nextSrc = getLotCameraFrameUrl(
        { backendLotId: lot.backendLotId },
        { showDetections: canShowVehicleDetections && showVehicleDetections },
      );
      const preloader = new Image();
      preloader.onload = () => {
        if (!cancelled) {
          setCameraFrameSrc(nextSrc);
        }
      };
      preloader.src = nextSrc;
    };

    loadFreshFrame();
    const intervalId = window.setInterval(loadFreshFrame, CAMERA_FRAME_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [canShowVehicleDetections, lot.backendLotId, showVehicleDetections]);

  useEffect(() => {
    writeStoredDiagramView(lot.id, diagramView);
  }, [diagramView, lot.id]);

  useEffect(() => {
    if (!lot.spaces.length) {
      return;
    }

    const needsNormalization = lot.spaces.some(
      (space) =>
        Number(space.width) !== DIAGRAM_SPOT_WIDTH ||
        Number(space.height) !== DIAGRAM_SPOT_HEIGHT,
    );

    if (!needsNormalization) {
      return;
    }

    onLotChange((currentLot) => ({
      ...currentLot,
      spaces: currentLot.spaces.map((space) => {
        const currentWidth = Number(space.width) || DIAGRAM_SPOT_WIDTH;
        const currentHeight = Number(space.height) || DIAGRAM_SPOT_HEIGHT;
        const centerX = Number(space.x) + currentWidth / 2;
        const centerY = Number(space.y) + currentHeight / 2;

        return {
          ...space,
          width: DIAGRAM_SPOT_WIDTH,
          height: DIAGRAM_SPOT_HEIGHT,
          x: clampDiagramX(centerX - DIAGRAM_SPOT_WIDTH / 2, DIAGRAM_SPOT_WIDTH),
          y: clampDiagramY(centerY - DIAGRAM_SPOT_HEIGHT / 2, DIAGRAM_SPOT_HEIGHT),
        };
      }),
    }));
  }, [lot.spaces, onLotChange]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        const panState = diagramPanStateRef.current;
        if (!panState) {
          return;
        }

        const frameElement = diagramFrameRef.current;
        if (!frameElement) {
          return;
        }

        const bounds = frameElement.getBoundingClientRect();
        const deltaX = ((event.clientX - panState.clientX) / bounds.width) * 100;
        const deltaY = ((event.clientY - panState.clientY) / bounds.height) * 100;

        setDiagramView((currentView) =>
          clampDiagramView({
            ...currentView,
            left: panState.left + deltaX,
            top: panState.top + deltaY,
          }),
        );
        return;
      }

      const spot = lot.spaces.find((space) => space.id === dragState.spotId);
      if (!spot) {
        return;
      }

      const canvasElement = diagramCanvasRef.current;
      if (!canvasElement) {
        return;
      }

      const bounds = canvasElement.getBoundingClientRect();
      const offsetX = dragState.pointerOffset?.x ?? spot.width / 2;
      const offsetY = dragState.pointerOffset?.y ?? spot.height / 2;
      const x = ((event.clientX - bounds.left) / bounds.width) * 100 - offsetX;
      const y = ((event.clientY - bounds.top) / bounds.height) * 100 - offsetY;

      onLotChange((currentLot) => ({
        ...currentLot,
        spaces: currentLot.spaces.map((space) =>
          space.id === spot.id
            ? {
                ...space,
                x: clampDiagramX(x, spot.width),
                y: clampDiagramY(y, spot.height),
              }
            : space,
        ),
      }));
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      diagramPanStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [lot.spaces, onLotChange]);

  useEffect(() => {
    if (!isCameraExpanded) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCameraExpanded]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (isCameraExpanded) {
        setIsCameraExpanded(false);
        return;
      }

      if (isMappingCamera) {
        setIsMappingCamera(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCameraExpanded, isMappingCamera]);

  const updateSpaces = (updater) => {
    onLotChange((currentLot) => ({
      ...currentLot,
      spaces: typeof updater === "function" ? updater(currentLot.spaces) : updater,
    }));
  };

  const updateSelectedSpot = (patch) => {
    if (!selectedSpot) {
      return;
    }

    updateSpaces((currentSpaces) =>
      currentSpaces.map((space) => (space.id === selectedSpot.id ? { ...space, ...patch } : space)),
    );
  };

  const addSpot = () => {
    const spotId = `space-${Date.now()}`;
    const newSpot = {
      id: spotId,
      label: nextSpotLabel(lot.spaces),
      status: "open",
      x: 12 + (lot.spaces.length % 5) * 14,
      y: lot.spaces.length >= 5 ? 56 : 18,
      width: DIAGRAM_SPOT_WIDTH,
      height: DIAGRAM_SPOT_HEIGHT,
      rotation: 0,
      polygon: undefined,
    };

    updateSpaces((currentSpaces) => [...currentSpaces, newSpot]);
    setSelectedSpotId(spotId);
    setIsMappingCamera(true);
  };

  const deleteSpot = () => {
    if (!selectedSpot) {
      return;
    }

    const remainingSpots = lot.spaces.filter((space) => space.id !== selectedSpot.id);
    updateSpaces((currentSpaces) => currentSpaces.filter((space) => space.id !== selectedSpot.id));
    setSelectedSpotId(remainingSpots[0]?.id ?? "");
    setIsMappingCamera(false);
  };

  const undoLastCameraPoint = () => {
    if (!selectedSpot || !selectedPolygonPointCount) {
      return;
    }

    updateSelectedSpot({ polygon: selectedPolygon.slice(0, -1) });
  };

  const clearSelectedPolygon = () => {
    if (!selectedSpot) {
      return;
    }

    updateSelectedSpot({ polygon: undefined });
  };

  const nudgeSelectedSpot = (deltaX, deltaY) => {
    if (!selectedSpot) {
      return;
    }

    updateSelectedSpot({
      x: clampDiagramX(selectedSpot.x + deltaX, selectedSpot.width),
      y: clampDiagramY(selectedSpot.y + deltaY, selectedSpot.height),
    });
  };

  const updateDiagramView = (updater) => {
    setDiagramView((currentView) =>
      clampDiagramView(typeof updater === "function" ? updater(currentView) : updater),
    );
  };

  const adjustDiagramZoom = (nextZoom) => {
    updateDiagramView((currentView) => {
      const resolvedZoom = clampValue(
        typeof nextZoom === "function" ? nextZoom(currentView.zoom) : nextZoom,
        DIAGRAM_ZOOM_MIN,
        DIAGRAM_ZOOM_MAX,
      );

      if (resolvedZoom === currentView.zoom) {
        return currentView;
      }

      const centerX = (50 - currentView.left) / currentView.zoom;
      const centerY = (50 - currentView.top) / currentView.zoom;

      return {
        zoom: resolvedZoom,
        left: 50 - centerX * resolvedZoom,
        top: 50 - centerY * resolvedZoom,
      };
    });
  };

  const resetDiagramView = () => {
    updateDiagramView(getDefaultDiagramView(lot.spaces));
  };

  const beginSelectedSpotOutline = () => {
    if (!selectedSpot) {
      return;
    }

    updateSelectedSpot({ polygon: [] });
    setIsMappingCamera(true);
  };

  const saveSelectedSpotOutline = () => {
    if (!selectedSpot) {
      return;
    }

    setIsMappingCamera(false);
  };

  const openFullscreenCamera = () => {
    setIsCameraExpanded(true);
  };

  const handleCameraClick = (event) => {
    if (!selectedSpot || !isMappingCamera) {
      return;
    }

    const frameElement = event.currentTarget;
    if (!frameElement) {
      return;
    }

    const frameBounds = frameElement.getBoundingClientRect();
    if (frameBounds.width <= 0 || frameBounds.height <= 0) {
      return;
    }

    const localX = event.clientX - frameBounds.left;
    const localY = event.clientY - frameBounds.top;
    const clampedX = Math.min(Math.max(localX, 0), frameBounds.width);
    const clampedY = Math.min(Math.max(localY, 0), frameBounds.height);
    const x = (clampedX / frameBounds.width) * cameraSize.width;
    const y = (clampedY / frameBounds.height) * cameraSize.height;
    const nextPolygon = [
      ...selectedPolygon,
      { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) },
    ];

    updateSelectedSpot({ polygon: nextPolygon });
  };

  const renderSpotList = (keyPrefix = "") => (
    <div className="lot-editor__spot-list">
      {lot.spaces.map((space) => {
        const pointCount = getPolygonPointCount(space);

        return (
          <button
            className={`spot-list-button ${space.id === selectedSpot?.id ? "spot-list-button--active" : ""}`}
            key={`${keyPrefix}${space.id}`}
            onClick={() => setSelectedSpotId(space.id)}
            type="button"
          >
            {pointCount ? `${space.label} - ${pointCount} pts` : `${space.label} - New`}
          </button>
        );
      })}
    </div>
  );

  const renderSpotSelector = () =>
    lot.spaces.length ? (
      <div className="lot-editor__select-group">
        <label className="lot-editor__select-field">
          <span>Selected Spot</span>
          <select
            onChange={(event) => setSelectedSpotId(event.target.value)}
            value={effectiveSelectedSpotId}
          >
            {lot.spaces.map((space) => (
              <option key={`selector-${space.id}`} value={space.id}>
                {space.label}
              </option>
            ))}
          </select>
        </label>

        <div className="lot-editor__actions lot-editor__actions--wrap">
          <button className="button-secondary" onClick={addSpot} type="button">
            Add Spot
          </button>
          <button
            className="button-danger"
            disabled={!selectedSpot}
            onClick={deleteSpot}
            type="button"
          >
            Delete Spot
          </button>
        </div>
      </div>
    ) : (
      <div className="lot-editor__select-group">
        <p className="lot-editor__empty">No spots yet.</p>
        <div className="lot-editor__actions">
          <button className="button-secondary" onClick={addSpot} type="button">
            Add Spot
          </button>
        </div>
      </div>
    );

  const renderSpotFields = (fieldClassName) =>
    selectedSpot ? (
      <div className={fieldClassName}>
        <label>
          <span>Spot ID</span>
          <input
            onChange={(event) => updateSelectedSpot({ label: event.target.value })}
            type="text"
            value={selectedSpot.label}
          />
        </label>
        <label>
          <span>X</span>
          <input
            onChange={(event) =>
              updateSelectedSpot({ x: clampDiagramX(event.target.value, selectedSpot.width) })
            }
            type="number"
            value={selectedSpot.x}
          />
        </label>
        <label>
          <span>Y</span>
          <input
            onChange={(event) =>
              updateSelectedSpot({ y: clampDiagramY(event.target.value, selectedSpot.height) })
            }
            type="number"
            value={selectedSpot.y}
          />
        </label>
        <label>
          <span>Rotation</span>
          <input
            onChange={(event) => updateSelectedSpot({ rotation: Number(event.target.value) || 0 })}
            type="number"
            value={selectedSpot.rotation || 0}
          />
        </label>
      </div>
    ) : (
      <p className="lot-editor__empty">Add a spot to start building the layout.</p>
    );

  const renderCameraStatus = () => (
    <div className="lot-editor__status-strip">
      <span className="lot-editor__badge">{selectedSpot ? `Selected: ${selectedSpot.label}` : "Select a spot"}</span>
    </div>
  );

  const renderCameraToolbar = ({ showAddSpotButton = false, showFullscreenButton = true } = {}) => (
    <div className="lot-editor__toolbar">
      <div className="lot-editor__toolbar-group">
        <button
          className={isMappingCamera ? "button-primary" : "button-secondary"}
          disabled={!selectedSpot}
          onClick={isMappingCamera ? saveSelectedSpotOutline : beginSelectedSpotOutline}
          type="button"
        >
          {isMappingCamera ? "Save Spot" : "Outline Spot"}
        </button>
        {showAddSpotButton ? (
          <button className="button-secondary" onClick={addSpot} type="button">
            Add Spot
          </button>
        ) : null}
        <button
          className="button-secondary"
          disabled={!selectedSpot || !selectedPolygonPointCount}
          onClick={undoLastCameraPoint}
          type="button"
        >
          Undo Point
        </button>
        <button
          className="button-secondary"
          disabled={!selectedSpot || !selectedPolygonPointCount}
          onClick={clearSelectedPolygon}
          type="button"
        >
          Clear Outline
        </button>
        {showFullscreenButton ? (
          <button className="button-secondary" onClick={openFullscreenCamera} type="button">
            Enlarge Spot Editor
          </button>
        ) : null}
      </div>
      {canShowVehicleDetections ? (
        <label className="lot-editor__toggle">
          <input
            checked={showVehicleDetections}
            onChange={(event) => setShowVehicleDetections(event.target.checked)}
            type="checkbox"
          />
          <span>Show car detections</span>
        </label>
      ) : null}
    </div>
  );

  const renderCameraMarkup = (extraClassName = "", options = {}) => (
    <div className={extraClassName ? `camera-match ${extraClassName}` : "camera-match"}>
      <div className="camera-match__viewport" ref={options.viewportRef}>
        <div
          className={`camera-match__frame ${
            isMappingCamera ? "camera-match__frame--mapping" : ""
          }`}
          onClick={handleCameraClick}
          role="presentation"
          style={
            options.frameWidth
              ? { width: `${options.frameWidth}px` }
              : { width: "100%" }
          }
        >
          <img
            alt={`${lot.name} camera frame`}
            className="camera-match__image"
            onLoad={(event) =>
              setCameraSize({
                width: event.currentTarget.naturalWidth || 1280,
                height: event.currentTarget.naturalHeight || 720,
              })
            }
            src={cameraFrameSrc}
          />
          <svg
            className="camera-match__overlay"
            viewBox={`0 0 ${cameraSize.width} ${cameraSize.height}`}
          >
            {lot.spaces.map((space) => {
              const polygon = Array.isArray(space.polygon) ? space.polygon : [];
              const centroid = polygonCentroid(polygon);
              const isSelected = space.id === selectedSpot?.id;

              return (
                <g
                  key={space.id}
                  onClick={
                    isMappingCamera
                      ? undefined
                      : (event) => {
                          event.stopPropagation();
                          setSelectedSpotId(space.id);
                        }
                  }
                  role="presentation"
                >
                  {polygon.length >= 3 ? (
                    <polygon
                      className={
                        isSelected
                          ? "camera-polygon camera-polygon--selected"
                          : "camera-polygon"
                      }
                      points={polygonPoints(polygon)}
                    />
                  ) : null}
                  {isSelected && polygon.length >= 2 && polygon.length < 3 ? (
                    <polyline
                      className="camera-polygon camera-polygon--draft"
                      points={polygonPoints(polygon)}
                    />
                  ) : null}
                  {centroid && polygon.length >= 3 ? (
                    <text className="camera-polygon__label" x={centroid.x} y={centroid.y}>
                      {space.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {selectedPolygon.map((point, index) => (
              <g key={`${selectedSpot?.id || "spot"}-point-${index + 1}`}>
                <circle className="camera-polygon__point" cx={point.x} cy={point.y} r="7" />
                <text className="camera-polygon__point-label" x={point.x} y={point.y - 16}>
                  {index + 1}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );

  const modalSpotControls = (
    <div className="camera-modal__controls">
        <div className="lot-editor__section">
          <div className="lot-editor__section-header lot-editor__section-header--stacked">
            <strong>Camera Workflow</strong>
            <span>
            1. Pick a spot. 2. Start outlining. 3. Click around the spot boundary. 4. Use
            undo or clear if needed.
          </span>
        </div>
        {renderCameraStatus()}
        <p className="lot-editor__helper">{workflowHelperText}</p>
        {renderCameraToolbar({ showAddSpotButton: true, showFullscreenButton: false })}
        </div>

        <div className="lot-editor__section">
          <div className="lot-editor__section-header lot-editor__section-header--stacked">
            <strong>Spots</strong>
            <span>{lot.spaces.length} total spots in this lot.</span>
          </div>
          {renderSpotList("modal-")}
        </div>

      <div className="lot-editor__section">
        <div className="lot-editor__section-header lot-editor__section-header--stacked">
          <strong>Selected Spot</strong>
          <span>Use these fields for diagram placement and rotation.</span>
        </div>
        {renderSpotFields("camera-modal__fields")}
      </div>
    </div>
  );

  return (
    <>
      <aside className="lot-editor">
        <div className="lot-editor__header">
          <div>
            <p>{lot.name}</p>
            <h2>Lot Layout</h2>
          </div>
          <div className="lot-editor__header-meta">
            <span className="lot-editor__badge">{lot.spaces.length} spots</span>
          </div>
        </div>

        <div className="lot-editor__body">
          <div className="lot-editor__column lot-editor__column--sidebar">
            <div className="lot-editor__section">
              <div className="lot-editor__section-header lot-editor__section-header--stacked">
                <strong>Workflow</strong>
                <span>Select a spot, outline it, then place it on the diagram.</span>
              </div>
              {renderCameraStatus()}
              <p className="lot-editor__helper">{workflowHelperText}</p>
            </div>

            <div className="lot-editor__section">
              <div className="lot-editor__section-header lot-editor__section-header--stacked">
                <strong>Spot Controls</strong>
                <span>Pick the spot you want to edit.</span>
              </div>
              {renderSpotSelector()}
            </div>

            <div className="lot-editor__section">
              <div className="lot-editor__section-header lot-editor__section-header--stacked">
                <strong>Spot Details</strong>
                <span>Use direct values only when drag and nudge are not enough.</span>
              </div>
              {renderSpotFields("lot-editor__fields lot-editor__fields--compact")}
            </div>
          </div>

          <div className="lot-editor__workspace">
            <div className="lot-editor__section lot-editor__canvas-card">
              <div className="lot-editor__section-header lot-editor__section-header--stacked">
                <strong>1. Outline on Camera</strong>
                <span>Both views stay the same size here. Enlarge only when you need precision.</span>
              </div>
              {renderCameraToolbar()}
              {renderCameraMarkup("camera-match--editor", {
                frameWidth: editorCameraFrameWidth,
                viewportRef: cameraViewportRef,
              })}
            </div>

            <div className="lot-editor__section lot-editor__canvas-card">
              <div className="lot-editor__section-header lot-editor__section-header--stacked">
                <strong>2. Place on Diagram</strong>
                <span>Drag the box for rough placement, then use nudges and rotation for cleanup.</span>
              </div>
              <div className="lot-editor__diagram-view">
                <span>Diagram View</span>
                <div className="lot-editor__actions lot-editor__actions--wrap">
                  <button
                    aria-label="Zoom out diagram"
                    className="button-secondary"
                    disabled={diagramView.zoom <= DIAGRAM_ZOOM_MIN}
                    onClick={() => adjustDiagramZoom((currentZoom) => currentZoom - DIAGRAM_ZOOM_STEP)}
                    type="button"
                  >
                    -
                  </button>
                  <button
                    aria-label="Zoom in diagram"
                    className="button-secondary"
                    disabled={diagramView.zoom >= DIAGRAM_ZOOM_MAX}
                    onClick={() => adjustDiagramZoom((currentZoom) => currentZoom + DIAGRAM_ZOOM_STEP)}
                    type="button"
                  >
                    +
                  </button>
                  <button className="button-secondary" onClick={resetDiagramView} type="button">
                    Center View
                  </button>
                  <strong className="lot-editor__zoom-value">{diagramZoomPercent}%</strong>
                </div>
              </div>
              <div className="lot-editor__diagram-tools lot-editor__diagram-tools--inline">
                <div className="lot-editor__actions lot-editor__actions--wrap">
                  <button
                    className="button-secondary"
                    disabled={!selectedSpot}
                    onClick={() => nudgeSelectedSpot(0, -1)}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    className="button-secondary"
                    disabled={!selectedSpot}
                    onClick={() => nudgeSelectedSpot(-1, 0)}
                    type="button"
                  >
                    Left
                  </button>
                  <button
                    className="button-secondary"
                    disabled={!selectedSpot}
                    onClick={() => nudgeSelectedSpot(1, 0)}
                    type="button"
                  >
                    Right
                  </button>
                  <button
                    className="button-secondary"
                    disabled={!selectedSpot}
                    onClick={() => nudgeSelectedSpot(0, 1)}
                    type="button"
                  >
                    Down
                  </button>
                </div>

                {selectedSpot ? (
                  <label className="lot-editor__slider-field lot-editor__slider-field--inline">
                    <span>Diagram Rotation</span>
                    <input
                      max="180"
                      min="-180"
                      onChange={(event) =>
                        updateSelectedSpot({ rotation: Number(event.target.value) || 0 })
                      }
                      step="1"
                      type="range"
                      value={selectedSpot.rotation || 0}
                    />
                    <strong>{selectedSpot.rotation || 0}deg</strong>
                  </label>
                ) : null}
              </div>
              <div
                className="diagram-canvas diagram-canvas--editor"
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  if (event.target instanceof Element && event.target.closest(".diagram-space")) {
                    return;
                  }

                  event.preventDefault();
                  diagramPanStateRef.current = {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    left: diagramView.left,
                    top: diagramView.top,
                  };
                }}
                ref={diagramFrameRef}
                role="presentation"
              >
                <div className="diagram-viewport" ref={diagramCanvasRef} style={diagramViewportStyle}>
                  <LotDesignSurface label={`${lot.name} diagram editor`} />
                  <div className="diagram-overlay">
                    {lot.spaces.map((space) => {
                      const buttonBounds = (event) =>
                        event.currentTarget.getBoundingClientRect();

                      return (
                        <button
                          className={`diagram-space diagram-space--${space.status} ${
                            space.id === selectedSpot?.id ? "diagram-space--selected" : ""
                          }`}
                          key={space.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedSpotId(space.id);
                          }}
                          onPointerDown={(event) => {
                            const bounds = buttonBounds(event);

                            event.stopPropagation();
                            event.preventDefault();
                            setSelectedSpotId(space.id);
                            dragStateRef.current = {
                              spotId: space.id,
                              pointerOffset: {
                                x:
                                  ((event.clientX - bounds.left) / bounds.width) * space.width,
                                y:
                                  ((event.clientY - bounds.top) / bounds.height) * space.height,
                              },
                            };
                          }}
                          style={{
                            left: `${space.x}%`,
                            top: `${space.y}%`,
                            width: `${space.width}%`,
                            height: `${space.height}%`,
                            transform: `rotate(${Number(space.rotation || 0)}deg)`,
                          }}
                          type="button"
                        >
                          <span>{space.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {isCameraExpanded ? (
        <div aria-modal="true" className="camera-modal" role="dialog">
          <div
            className="camera-modal__backdrop"
            onClick={() => setIsCameraExpanded(false)}
            role="presentation"
          />
          <div className="camera-modal__panel">
            <div className="camera-modal__header">
              <div>
                <strong>Fullscreen Camera Mapper</strong>
                <span>
                  {selectedSpot
                    ? `${selectedSpot.label}: click around the spot shape to redraw it`
                    : "Select a spot first"}
                </span>
              </div>
              <button
                className="button-secondary"
                onClick={() => setIsCameraExpanded(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="camera-modal__body">
              {modalSpotControls}
              {renderCameraMarkup("camera-match--modal", {
                frameWidth: modalCameraFrameWidth,
                viewportRef: modalCameraViewportRef,
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
