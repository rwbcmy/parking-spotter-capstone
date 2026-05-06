import { useEffect, useMemo, useRef, useState } from "react";
import { getLotLocation, UNIVERSITY_OF_MISSOURI } from "../utils/map";

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const DEFAULT_ZOOM = 17;

function latLngToWorld(lat, lng, zoom) {
  const scale = 2 ** zoom * TILE_SIZE;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y:
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
      scale,
  };
}

function worldToLatLng(x, y, zoom) {
  const scale = 2 ** zoom * TILE_SIZE;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function buildTiles(center, zoom, width, height) {
  const centerWorld = latLngToWorld(center.lat, center.lng, zoom);
  const topLeftX = centerWorld.x - width / 2;
  const topLeftY = centerWorld.y - height / 2;
  const startX = Math.floor(topLeftX / TILE_SIZE);
  const endX = Math.floor((topLeftX + width) / TILE_SIZE);
  const startY = Math.floor(topLeftY / TILE_SIZE);
  const endY = Math.floor((topLeftY + height) / TILE_SIZE);
  const maxIndex = 2 ** zoom;
  const tiles = [];

  for (let tileX = startX; tileX <= endX; tileX += 1) {
    for (let tileY = startY; tileY <= endY; tileY += 1) {
      if (tileY < 0 || tileY >= maxIndex) {
        continue;
      }

      const wrappedX = ((tileX % maxIndex) + maxIndex) % maxIndex;
      tiles.push({
        key: `${zoom}-${wrappedX}-${tileY}`,
        left: tileX * TILE_SIZE - topLeftX,
        top: tileY * TILE_SIZE - topLeftY,
        src: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${wrappedX}`,
      });
    }
  }

  return { centerWorld, topLeftX, topLeftY, tiles };
}

function lotPixelBox(lot, zoom, topLeftX, topLeftY) {
  const location = getLotLocation(lot);
  const topLeft = latLngToWorld(location.lat + location.latSpan / 2, location.lng - location.lngSpan / 2, zoom);
  const bottomRight = latLngToWorld(location.lat - location.latSpan / 2, location.lng + location.lngSpan / 2, zoom);
  return {
    left: topLeft.x - topLeftX,
    top: topLeft.y - topLeftY,
    width: Math.max(bottomRight.x - topLeft.x, 18),
    height: Math.max(bottomRight.y - topLeft.y, 18),
  };
}

export default function CoverageMap({
  emphasisLotId,
  isDrawingLot = false,
  lots,
  mode = "user",
  onLotDraw,
  onSelectLot,
  selectedLotOverlay = null,
  selectedLotId,
}) {
  const mapRef = useRef(null);
  const [size, setSize] = useState({ width: 1280, height: 720 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [center, setCenter] = useState(UNIVERSITY_OF_MISSOURI);
  const [draftRect, setDraftRect] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const drawStartRef = useRef(null);
  const panStartRef = useRef(null);
  const isDraggingRef = useRef(false);
  const lastAutoCenterKeyRef = useRef("");
  const wheelLockRef = useRef(false);

  const focusLot = useMemo(
    () => lots.find((lot) => lot.id === selectedLotId) ?? lots.find((lot) => lot.id === emphasisLotId) ?? null,
    [emphasisLotId, lots, selectedLotId],
  );

  useEffect(() => {
    if (mode === "user" && !selectedLotId && lastAutoCenterKeyRef.current) {
      return;
    }

    const nextKey = focusLot ? `${focusLot.id}:${mode}` : `none:${mode}:${lots.length}`;
    if (lastAutoCenterKeyRef.current === nextKey) {
      return;
    }

    lastAutoCenterKeyRef.current = nextKey;
    const target = focusLot ? getLotLocation(focusLot) : UNIVERSITY_OF_MISSOURI;
    const centeredTarget =
      focusLot && mode === "user"
        ? {
            ...target,
            lat: target.lat + Math.max(target.latSpan || 0.00018, 0.00018) * 2.1,
          }
        : target;
    setCenter(centeredTarget);
  }, [focusLot, lots.length, mode]);

  useEffect(() => {
    const updateSize = () => {
      if (!mapRef.current) {
        return;
      }

      const bounds = mapRef.current.getBoundingClientRect();
      setSize({
        width: Math.max(bounds.width, 320),
        height: Math.max(bounds.height, 320),
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    const mapElement = mapRef.current;
    if (!mapElement) {
      return undefined;
    }

    const nativeWheelHandler = (event) => {
      event.preventDefault();
      handleWheel(event);
    };

    mapElement.addEventListener("wheel", nativeWheelHandler, { passive: false });
    return () => mapElement.removeEventListener("wheel", nativeWheelHandler);
  });

  const { topLeftX, topLeftY, tiles } = useMemo(
    () => buildTiles(center, zoom, size.width, size.height),
    [center, size.height, size.width, zoom],
  );

  const pointFromEvent = (event) => {
    if (!mapRef.current) {
      return UNIVERSITY_OF_MISSOURI;
    }

    const bounds = mapRef.current.getBoundingClientRect();
    const pixelX = event.clientX - bounds.left;
    const pixelY = event.clientY - bounds.top;
    return worldToLatLng(topLeftX + pixelX, topLeftY + pixelY, zoom);
  };

  const zoomAtPoint = (nextZoom, clientX, clientY) => {
    if (!mapRef.current) {
      setZoom(nextZoom);
      return;
    }

    const bounds = mapRef.current.getBoundingClientRect();
    const pixelX = clientX - bounds.left;
    const pixelY = clientY - bounds.top;
    const anchorBefore = worldToLatLng(topLeftX + pixelX, topLeftY + pixelY, zoom);
    const anchorWorldAfter = latLngToWorld(anchorBefore.lat, anchorBefore.lng, nextZoom);
    const nextCenter = worldToLatLng(
      anchorWorldAfter.x - (pixelX - size.width / 2),
      anchorWorldAfter.y - (pixelY - size.height / 2),
      nextZoom,
    );

    setZoom(nextZoom);
    setCenter((currentCenter) => ({
      ...currentCenter,
      lat: nextCenter.lat,
      lng: nextCenter.lng,
    }));
  };

  const zoomAtCenter = (nextZoom) => {
    if (!mapRef.current) {
      setZoom(nextZoom);
      return;
    }

    const bounds = mapRef.current.getBoundingClientRect();
    zoomAtPoint(nextZoom, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  };

  const handleSearch = async (event) => {
    event.preventDefault();

    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchMessage("Enter an address or business name.");
      return;
    }

    setIsSearching(true);
    setSearchMessage("");
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const results = await response.json();
      if (!Array.isArray(results) || results.length === 0) {
        setSearchResults([]);
        setSearchMessage("No results found.");
        return;
      }

      setSearchResults(results);
    } catch {
      setSearchResults([]);
      setSearchMessage("Search is unavailable right now.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchResultSelect = (result) => {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    setCenter({
      lat,
      lng,
      latSpan: 0.0012,
      lngSpan: 0.0018,
    });
    setZoom((value) => Math.max(value, 18));
    setSearchQuery(result.display_name || "");
    setSearchResults([]);
    setSearchMessage("");
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    const clickedLot = event.target instanceof Element && event.target.closest(".world-map__lot");
    if (clickedLot) {
      return;
    }

    if (mode === "admin" && isDrawingLot && onLotDraw) {
      drawStartRef.current = pointFromEvent(event);
      setDraftRect({ start: drawStartRef.current, end: drawStartRef.current });
      return;
    }

    panStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      center,
    };
    isDraggingRef.current = false;
  };

  const handlePointerMove = (event) => {
    if (drawStartRef.current) {
      setDraftRect({
        start: drawStartRef.current,
        end: pointFromEvent(event),
      });
      return;
    }

    if (!panStartRef.current) {
      return;
    }

    const deltaX = event.clientX - panStartRef.current.clientX;
    const deltaY = event.clientY - panStartRef.current.clientY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      isDraggingRef.current = true;
    }

    const startWorld = latLngToWorld(
      panStartRef.current.center.lat,
      panStartRef.current.center.lng,
      zoom,
    );
    const nextCenter = worldToLatLng(startWorld.x - deltaX, startWorld.y - deltaY, zoom);
    setCenter((currentCenter) => ({
      ...currentCenter,
      lat: nextCenter.lat,
      lng: nextCenter.lng,
    }));
  };

  const handlePointerUp = (event) => {
    if (drawStartRef.current && onLotDraw) {
      const end = pointFromEvent(event);
      const start = drawStartRef.current;
      drawStartRef.current = null;
      setDraftRect(null);

      const north = Math.max(start.lat, end.lat);
      const south = Math.min(start.lat, end.lat);
      const east = Math.max(start.lng, end.lng);
      const west = Math.min(start.lng, end.lng);

      onLotDraw({
        lat: (north + south) / 2,
        lng: (east + west) / 2,
        latSpan: Math.max(north - south, 0.00018),
        lngSpan: Math.max(east - west, 0.00018),
      });
      return;
    }

    panStartRef.current = null;
    window.setTimeout(() => {
      isDraggingRef.current = false;
    }, 0);
  };

  const handlePointerLeave = () => {
    drawStartRef.current = null;
    panStartRef.current = null;
    setDraftRect(null);
    isDraggingRef.current = false;
  };

  const handleWheel = (event) => {
    if (wheelLockRef.current) {
      return;
    }

    wheelLockRef.current = true;
    window.setTimeout(() => {
      wheelLockRef.current = false;
    }, 80);

    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = clampZoom(zoom + direction);
    if (nextZoom === zoom) {
      return;
    }

    zoomAtPoint(nextZoom, event.clientX, event.clientY);
  };

  const renderBounds = (lot, extraClassName = "") => {
    const bounds = lotPixelBox(lot, zoom, topLeftX, topLeftY);
    return (
      <button
        className={`world-map__lot ${extraClassName}`.trim()}
        key={lot.id}
        onClick={() => {
          if (!isDraggingRef.current) {
            onSelectLot(lot.id);
          }
        }}
        style={{
          left: `${bounds.left}px`,
          top: `${bounds.top}px`,
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
        }}
        type="button"
      >
        <span>{lot.name}</span>
      </button>
    );
  };

  const selectedLotPopupStyle = useMemo(() => {
    if (mode !== "user" || !selectedLotOverlay || !focusLot) {
      return null;
    }

    const bounds = lotPixelBox(focusLot, zoom, topLeftX, topLeftY);
    const popupWidth = Math.min(420, Math.max(size.width - 32, 280));
    const left = Math.min(
      Math.max(bounds.left + bounds.width / 2, popupWidth / 2 + 16),
      size.width - popupWidth / 2 - 16,
    );
    const top = Math.max(bounds.top - 28, 16);

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${popupWidth}px`,
    };
  }, [focusLot, mode, selectedLotOverlay, size.width, topLeftX, topLeftY, zoom]);

  const draftStyle = useMemo(() => {
    if (!draftRect) {
      return null;
    }

    const start = latLngToWorld(draftRect.start.lat, draftRect.start.lng, zoom);
    const end = latLngToWorld(draftRect.end.lat, draftRect.end.lng, zoom);
    const left = Math.min(start.x, end.x) - topLeftX;
    const top = Math.min(start.y, end.y) - topLeftY;
    return {
      left,
      top,
      width: Math.max(Math.abs(end.x - start.x), 18),
      height: Math.max(Math.abs(end.y - start.y), 18),
    };
  }, [draftRect, topLeftX, topLeftY, zoom]);

  return (
    <div className="world-map-shell">
      <div
        className={`world-map ${isDrawingLot ? "world-map--drawing" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={mapRef}
        role="presentation"
      >
        <div className="world-map__tiles">
          {tiles.map((tile) => (
            <img
              alt=""
              className="world-map__tile"
              draggable="false"
              key={tile.key}
              src={tile.src}
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
        </div>

        <div className="world-map__overlay">
          {lots.map((lot) =>
            renderBounds(
              lot,
              lot.id === selectedLotId
                ? "world-map__lot--active"
                : lot.id === emphasisLotId
                  ? "world-map__lot--focus"
                  : "",
            ),
          )}

          {draftStyle ? (
            <div
              className="world-map__draft"
              style={{
                left: `${draftStyle.left}px`,
                top: `${draftStyle.top}px`,
                width: `${draftStyle.width}px`,
                height: `${draftStyle.height}px`,
              }}
            />
          ) : null}

          {selectedLotPopupStyle ? (
            <div className="world-map__lot-popup" style={selectedLotPopupStyle}>
              {selectedLotOverlay}
            </div>
          ) : null}
        </div>
      </div>

      <div className="world-map__hud">
        <div className="world-map__status world-map__status--search">
          <strong>{focusLot ? focusLot.name : "University of Missouri"}</strong>
          <span>{mode === "admin" ? "Draw a supported lot footprint" : "Click a supported lot"}</span>
          <form className="world-map__search" onSubmit={handleSearch}>
            <input
              className="world-map__search-input"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search address or business"
              type="text"
              value={searchQuery}
            />
            <button className="map-control map-control--wide" disabled={isSearching} type="submit">
              {isSearching ? "Searching" : "Search"}
            </button>
          </form>
          {searchResults.length > 0 ? (
            <div className="world-map__results">
              {searchResults.map((result) => (
                <button
                  className="world-map__result"
                  key={`${result.place_id}-${result.lat}-${result.lon}`}
                  onClick={() => handleSearchResultSelect(result)}
                  type="button"
                >
                  {result.display_name}
                </button>
              ))}
            </div>
          ) : null}
          {searchMessage ? <div className="world-map__search-message">{searchMessage}</div> : null}
        </div>
        <div className="world-map__controls">
          <button
            className="map-control"
            onClick={() => zoomAtCenter(clampZoom(zoom + 1))}
            type="button"
          >
            +
          </button>
          <button
            className="map-control"
            onClick={() => zoomAtCenter(clampZoom(zoom - 1))}
            type="button"
          >
            -
          </button>
          <button
            className="map-control map-control--wide"
            onClick={() => setCenter(focusLot ? getLotLocation(focusLot) : UNIVERSITY_OF_MISSOURI)}
            type="button"
          >
            Center
          </button>
        </div>
      </div>
    </div>
  );
}
