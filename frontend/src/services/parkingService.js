import { BUILTIN_LOCAL_LOTS } from "../data/defaultLots";
import { buildMetrics, cloneLot, polygonToSpaceRect, spaceToPolygon } from "../utils/geometry";
import { normalizeLotLocation, UNIVERSITY_OF_MISSOURI } from "../utils/map";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const STORAGE_KEY = "parking-spotter.local-lots.v2";

function ensureCameraPolygon(space, canvas) {
  if (Array.isArray(space.polygon) && space.polygon.length >= 3) {
    return space.polygon.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  }

  return spaceToPolygon(space, canvas);
}

async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getLatestCameraFrameUrl() {
  return `${API_BASE_URL}/camera/frame?t=${Date.now()}`;
}

export function getLotCameraFrameUrl(lot, options = {}) {
  const backendLotId = lot?.backendLotId;
  const showDetections = Boolean(options.showDetections);
  if (!backendLotId) {
    return `${API_BASE_URL}/camera/frame${showDetections ? "?overlay=detections&" : "?"}t=${Date.now()}`;
  }

  const params = new URLSearchParams({
    lot_id: String(backendLotId),
    t: String(Date.now()),
  });

  if (showDetections) {
    params.set("overlay", "detections");
  }

  return `${API_BASE_URL}/camera/frame?${params.toString()}`;
}

function readStoredLots() {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return BUILTIN_LOCAL_LOTS.map(cloneLot);
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return BUILTIN_LOCAL_LOTS.map(cloneLot);
    }

    return parsedValue.filter((lot) => lot.source !== "backend").map(cloneLot);
  } catch {
    return BUILTIN_LOCAL_LOTS.map(cloneLot);
  }
}

function writeStoredLots(lots) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lots));
}

async function probeBackendHealth() {
  try {
    const health = await apiRequest("/health");
    return { ok: Boolean(health.ok), source: "backend", raw: health };
  } catch {
    return { ok: false, source: "fallback", raw: null };
  }
}

function resolveSpaceStatus(space) {
  return space.occupied ? "occupied" : "open";
}

function hasSavedDiagramGeometry(space) {
  return [space.editor_x, space.editor_y, space.editor_width, space.editor_height].every(
    (value) => Number.isFinite(Number(value)),
  );
}

function buildBackendLot(liveLot) {
  const lot = liveLot.lot || {};
  const canvas = lot.canvas || { width: 1000, height: 600 };
  const spaces = (liveLot.spaces || []).map((space) => {
    const metadata = {
      id: `backend-space-${space.space_id}`,
      label: space.label,
      backendSpaceId: space.space_id,
      confidence: space.confidence ?? null,
      lastUpdated: space.last_updated ?? null,
      polygon: Array.isArray(space.polygon) ? space.polygon.map((point) => ({ ...point })) : undefined,
    };

    const rect = hasSavedDiagramGeometry(space)
      ? {
          ...metadata,
          x: Number(space.editor_x),
          y: Number(space.editor_y),
          width: Number(space.editor_width),
          height: Number(space.editor_height),
          rotation: Number(space.editor_rotation) || 0,
        }
      : polygonToSpaceRect(space.polygon, {
          fallbackId: metadata.id,
          fallbackLabel: metadata.label,
          backendSpaceId: metadata.backendSpaceId,
          confidence: metadata.confidence,
          lastUpdated: metadata.lastUpdated,
          canvas,
        });

    return {
      ...rect,
      polygon: metadata.polygon ?? spaceToPolygon(rect, canvas),
      status: resolveSpaceStatus({
        occupied: Boolean(space.occupied),
        lastUpdated: space.last_updated ?? null,
      }),
    };
  });

  return {
    id: `backend-lot-${lot.lot_id}`,
    backendLotId: lot.lot_id,
    name: lot.name || "Demo Lot",
    description: lot.description || "",
    status: lot.status || "active",
    source: "backend",
    location: normalizeLotLocation(lot.location),
    cameraUrl: lot.camera_url || "",
    isDefault: Boolean(lot.is_default),
    canvas,
    spaces,
    metrics: buildMetrics(spaces),
    updatedAt: new Date().toISOString(),
  };
}

function withMetrics(lot) {
  const normalizedLocation = normalizeLotLocation(lot.location);
  const nextSpaces = lot.spaces.map((space) => ({
    ...space,
    polygon: ensureCameraPolygon(space, lot.canvas),
  }));

  return {
    ...lot,
    location: normalizedLocation,
    cameraUrl: lot.cameraUrl || "",
    isDefault: Boolean(lot.isDefault),
    spaces: nextSpaces,
    metrics: buildMetrics(nextSpaces),
  };
}

function mergeBackendLot(baseLot, incomingLot) {
  const overrideByLabel = new Map(baseLot.spaces.map((space) => [space.label, space]));

  const mergedSpaces = incomingLot.spaces.map((space) => {
    const override = overrideByLabel.get(space.label);
    if (!override) {
      return {
        ...space,
        polygon: ensureCameraPolygon(space, incomingLot.canvas),
      };
    }

    return {
      ...space,
      x: override.x,
      y: override.y,
      width: override.width,
      height: override.height,
      rotation: override.rotation,
      polygon: ensureCameraPolygon(space, incomingLot.canvas),
    };
  });

  return {
    ...incomingLot,
    name: baseLot.name || incomingLot.name,
    description: baseLot.description || incomingLot.description,
    location: normalizeLotLocation(baseLot.location || incomingLot.location),
    cameraUrl: baseLot.cameraUrl || incomingLot.cameraUrl || "",
    isDefault: Boolean(baseLot.isDefault || incomingLot.isDefault),
    spaces: mergedSpaces,
    metrics: buildMetrics(mergedSpaces),
  };
}

export function mergeLotLiveState(baseLot, incomingLot) {
  if (!baseLot) {
    return incomingLot;
  }

  if (!incomingLot) {
    return withMetrics(baseLot);
  }

  if (baseLot.source !== "backend" || incomingLot.source !== "backend") {
    return withMetrics(baseLot);
  }

  if (!baseLot.spaces.length) {
    return withMetrics(incomingLot);
  }

  const incomingSpaces = new Map(
    incomingLot.spaces.map((space) => [space.backendSpaceId ?? space.label, space]),
  );

  const nextSpaces = baseLot.spaces.map((space) => {
    const incomingSpace = incomingSpaces.get(space.backendSpaceId ?? space.label);
    if (!incomingSpace) {
      return {
        ...space,
        polygon: Array.isArray(space.polygon) ? space.polygon.map((point) => ({ ...point })) : space.polygon,
      };
    }

    return {
      ...space,
      backendSpaceId: incomingSpace.backendSpaceId ?? space.backendSpaceId ?? null,
      confidence: incomingSpace.confidence ?? space.confidence ?? null,
      lastUpdated: incomingSpace.lastUpdated ?? space.lastUpdated ?? null,
      status: incomingSpace.status,
      polygon: Array.isArray(space.polygon) ? space.polygon.map((point) => ({ ...point })) : space.polygon,
    };
  });

  return {
    ...baseLot,
    backendLotId: incomingLot.backendLotId ?? baseLot.backendLotId,
    spaces: nextSpaces,
    metrics: buildMetrics(nextSpaces),
    updatedAt: incomingLot.updatedAt ?? new Date().toISOString(),
  };
}

export function mergeLotOccupancyState(baseLot, occupancySnapshot) {
  if (!baseLot || baseLot.source !== "backend" || !occupancySnapshot) {
    return baseLot ? withMetrics(baseLot) : baseLot;
  }

  const incomingSpaces = new Map(
    (occupancySnapshot.spaces || []).map((space) => [
      space.backendSpaceId ?? space.label,
      space,
    ]),
  );

  const nextSpaces = baseLot.spaces.map((space) => {
    const incomingSpace = incomingSpaces.get(space.backendSpaceId ?? space.label);
    if (!incomingSpace) {
      return {
        ...space,
        polygon: Array.isArray(space.polygon) ? space.polygon.map((point) => ({ ...point })) : space.polygon,
      };
    }

    return {
      ...space,
      confidence: incomingSpace.confidence ?? space.confidence ?? null,
      lastUpdated: incomingSpace.lastUpdated ?? space.lastUpdated ?? null,
      status: incomingSpace.status,
      polygon: Array.isArray(space.polygon) ? space.polygon.map((point) => ({ ...point })) : space.polygon,
    };
  });

  return {
    ...baseLot,
    spaces: nextSpaces,
    metrics: buildMetrics(nextSpaces),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchBackendLots() {
  try {
    const catalog = await apiRequest("/lots");
    const lotIds = (catalog.lots || []).map((lot) => lot.lot_id).filter(Boolean);
    const lotDetails = await Promise.all(lotIds.map((lotId) => apiRequest(`/lots/${lotId}`)));
    return lotDetails.map(buildBackendLot);
  } catch {
    return [];
  }
}

function mergeCatalog(localLots, backendLots) {
  const indexedLots = new Map(localLots.map((lot) => [lot.id, withMetrics(lot)]));

  backendLots.forEach((backendLot) => {
    const existingLot = indexedLots.get(backendLot.id);
    indexedLots.set(
      backendLot.id,
      existingLot ? mergeBackendLot(existingLot, backendLot) : withMetrics(backendLot),
    );
  });

  return [...indexedLots.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function getLotCatalog() {
  const [health, backendLots] = await Promise.all([probeBackendHealth(), fetchBackendLots()]);
  const lots = mergeCatalog(readStoredLots(), backendLots);
  return { health, lots };
}

export async function getLotDetail(lotId) {
  const healthPromise = probeBackendHealth();

  if (lotId.startsWith("backend-lot-")) {
    const backendLotId = Number(lotId.replace("backend-lot-", ""));
    if (!Number.isFinite(backendLotId)) {
      return null;
    }

    try {
      const [health, detail] = await Promise.all([healthPromise, apiRequest(`/lots/${backendLotId}`)]);
      return { health, lot: buildBackendLot(detail) };
    } catch {
      const localLot = readStoredLots().find((entry) => entry.id === lotId);
      return localLot ? { health: await healthPromise, lot: withMetrics(localLot) } : null;
    }
  }

  const localLot = readStoredLots().find((entry) => entry.id === lotId) ?? null;

  if (!localLot) {
    return null;
  }

  return { health: await healthPromise, lot: withMetrics(localLot) };
}

export async function getLotOccupancy(backendLotId) {
  if (!Number.isFinite(Number(backendLotId))) {
    return null;
  }

  try {
    const occupancy = await apiRequest(`/lots/${backendLotId}/occupancy`);
    return {
      backendLotId: Number(backendLotId),
      spaces: (occupancy.spaces || []).map((space) => ({
        backendSpaceId: space.space_id,
        label: space.label,
        confidence: space.confidence ?? null,
        lastUpdated: space.last_updated ?? null,
        status: resolveSpaceStatus(space),
      })),
    };
  } catch {
    return null;
  }
}

export function createLotDraft() {
  const now = Date.now();
  return withMetrics({
    id: `lot-${now}`,
    name: `New Lot ${new Date(now).toLocaleDateString()}`,
    description: "",
    status: "draft",
    source: "local",
    location: { ...UNIVERSITY_OF_MISSOURI },
    cameraUrl: "",
    isDefault: false,
    canvas: { width: 1000, height: 600 },
    spaces: [],
    updatedAt: new Date(now).toISOString(),
  });
}

function buildLayoutPayload(lot) {
  return {
    lot: {
      name: lot.name,
      description: lot.description,
      status: lot.status,
      location: normalizeLotLocation(lot.location),
      camera_url: lot.cameraUrl || "",
      is_default: Boolean(lot.isDefault),
      canvas: lot.canvas,
    },
    spaces: lot.spaces.map((space) => ({
      backend_space_id: space.backendSpaceId ?? null,
      label: space.label,
      polygon: ensureCameraPolygon(space, lot.canvas),
      editor: {
        x: space.x,
        y: space.y,
        width: space.width,
        height: space.height,
        rotation: space.rotation || 0,
      },
    })),
  };
}

export async function saveLotDraft(lot) {
  if (lot.source === "backend" && lot.backendLotId) {
    const result = await apiRequest(`/lots/${lot.backendLotId}/layout`, {
      method: "PUT",
      body: JSON.stringify(buildLayoutPayload(lot)),
    });

    return {
      lot: buildBackendLot(result),
      message: "Saved lot to the backend.",
    };
  }

  try {
    const result = await apiRequest("/lots", {
      method: "POST",
      body: JSON.stringify(buildLayoutPayload(lot)),
    });

    return {
      lot: buildBackendLot(result),
      message: "Created lot in the backend.",
    };
  } catch {
    const storedLots = readStoredLots();
    const normalizedLot = withMetrics(cloneLot(lot));

    const nextStoredLots = storedLots.some((entry) => entry.id === normalizedLot.id)
      ? storedLots.map((entry) => (entry.id === normalizedLot.id ? normalizedLot : entry))
      : [...storedLots, normalizedLot];

    writeStoredLots(nextStoredLots);

    return {
      lot: normalizedLot,
      message: "Saved lot draft to local browser storage.",
    };
  }
}

export async function deleteLotDraft(lotId) {
  if (lotId.startsWith("backend-lot-")) {
    const backendLotId = Number(lotId.replace("backend-lot-", ""));
    if (Number.isFinite(backendLotId)) {
      await apiRequest(`/lots/${backendLotId}`, {
        method: "DELETE",
      });
      return;
    }
  }

  const nextStoredLots = readStoredLots().filter((lot) => lot.id !== lotId);
  writeStoredLots(nextStoredLots);
}
