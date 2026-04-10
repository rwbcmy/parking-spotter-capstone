import { BUILTIN_LOCAL_LOTS } from "../data/defaultLots";
import {
  buildMetrics,
  cloneLot,
  polygonToSpaceRect,
  spaceToPolygon,
} from "../utils/geometry";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const STORAGE_KEY = "parking-spotter.local-lots.v2";
const STALE_STATUS_MS = 120000;

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

    return parsedValue.map(cloneLot);
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
  if (!space.lastUpdated) {
    return "unknown";
  }

  const ageMs = Date.now() - new Date(space.lastUpdated).getTime();
  if (Number.isNaN(ageMs) || ageMs > STALE_STATUS_MS) {
    return "unknown";
  }

  return space.occupied ? "occupied" : "open";
}

function buildBackendLot(liveOccupancy) {
  const spaces = (liveOccupancy.spaces || []).map((space) => {
    const rect = polygonToSpaceRect(space.polygon, {
      fallbackId: `backend-space-${space.space_id}`,
      fallbackLabel: space.label,
      backendSpaceId: space.space_id,
      confidence: space.confidence ?? null,
      lastUpdated: space.last_updated ?? null,
      occupied: Boolean(space.occupied),
    });

    return {
      ...rect,
      status: resolveSpaceStatus({
        occupied: Boolean(space.occupied),
        lastUpdated: space.last_updated ?? null,
      }),
    };
  });

  return {
    id: "backend-demo-lot",
    backendLotId: liveOccupancy.lot_id,
    name: "Demo Lot",
    description: "Connected to the current Flask occupancy endpoint in the capstone backend.",
    status: "active",
    source: "backend",
    region: "Main Campus",
    location: { x: 38, y: 58 },
    backgroundImage: "",
    canvas: { width: 1000, height: 600 },
    spaces,
    metrics: buildMetrics(spaces),
    updatedAt: new Date().toISOString(),
  };
}

function mergeBackendLot(baseLot, incomingLot) {
  const overrideByLabel = new Map(baseLot.spaces.map((space) => [space.label, space]));

  const mergedSpaces = incomingLot.spaces.map((space) => {
    const override = overrideByLabel.get(space.label);
    if (!override) {
      return {
        ...space,
        polygon: spaceToPolygon(space, incomingLot.canvas),
      };
    }

    return {
      ...space,
      x: override.x,
      y: override.y,
      width: override.width,
      height: override.height,
      rotation: override.rotation,
      polygon: spaceToPolygon(
        {
          ...space,
          x: override.x,
          y: override.y,
          width: override.width,
          height: override.height,
          rotation: override.rotation,
        },
        incomingLot.canvas,
      ),
    };
  });

  return {
    ...incomingLot,
    name: baseLot.name || incomingLot.name,
    description: baseLot.description || incomingLot.description,
    status: baseLot.status || incomingLot.status,
    region: baseLot.region || incomingLot.region,
    backgroundImage: baseLot.backgroundImage || incomingLot.backgroundImage,
    location: baseLot.location || incomingLot.location,
    spaces: mergedSpaces,
    metrics: buildMetrics(mergedSpaces),
  };
}

async function fetchBackendDemoLot() {
  try {
    const occupancy = await apiRequest("/lots/1/occupancy");
    return buildBackendLot(occupancy);
  } catch {
    return null;
  }
}

function withMetrics(lot) {
  const nextSpaces = lot.spaces.map((space) => ({
    ...space,
    polygon: space.polygon ?? spaceToPolygon(space, lot.canvas),
  }));

  return {
    ...lot,
    spaces: nextSpaces,
    metrics: buildMetrics(nextSpaces),
  };
}

function mergeCatalog(localLots, backendLot) {
  const indexedLots = new Map(localLots.map((lot) => [lot.id, withMetrics(lot)]));

  if (backendLot) {
    const existingLot = indexedLots.get(backendLot.id);
    indexedLots.set(
      backendLot.id,
      existingLot ? mergeBackendLot(existingLot, backendLot) : withMetrics(backendLot),
    );
  }

  return [...indexedLots.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function getLotCatalog() {
  const [health, backendLot] = await Promise.all([probeBackendHealth(), fetchBackendDemoLot()]);
  const lots = mergeCatalog(readStoredLots(), backendLot);
  return { health, lots };
}

export async function getLotDetail(lotId) {
  const [health, backendLot] = await Promise.all([probeBackendHealth(), fetchBackendDemoLot()]);
  const lots = mergeCatalog(readStoredLots(), backendLot);
  const lot = lots.find((entry) => entry.id === lotId) ?? lots[0] ?? null;

  if (!lot) {
    return null;
  }

  return { health, lot };
}

export function createLotDraft() {
  const now = Date.now();
  return withMetrics({
    id: `lot-${now}`,
    name: `New Lot ${new Date(now).toLocaleDateString()}`,
    description: "Fresh parking lot draft ready for a background upload and space layout.",
    status: "draft",
    source: "local",
    region: "Unassigned",
    location: { x: 52, y: 46 },
    backgroundImage: "",
    canvas: { width: 1000, height: 600 },
    spaces: [],
    updatedAt: new Date(now).toISOString(),
  });
}

export async function saveLotDraft(lot) {
  const storedLots = readStoredLots();
  const normalizedLot = withMetrics(cloneLot(lot));

  const nextStoredLots = storedLots.some((entry) => entry.id === normalizedLot.id)
    ? storedLots.map((entry) => (entry.id === normalizedLot.id ? normalizedLot : entry))
    : [...storedLots, normalizedLot];

  writeStoredLots(nextStoredLots);

  return {
    lot: normalizedLot,
    message:
      normalizedLot.source === "backend"
        ? "Saved local layout overrides for the live backend lot. Geometry is ready for future CRUD endpoints."
        : "Saved lot draft to local browser storage.",
  };
}

export async function deleteLotDraft(lotId) {
  const nextStoredLots = readStoredLots().filter((lot) => lot.id !== lotId);
  writeStoredLots(nextStoredLots);
}

export function downloadLotExport(lot) {
  const payload = {
    lot: {
      id: lot.backendLotId ?? null,
      name: lot.name,
      description: lot.description,
      status: lot.status,
      region: lot.region,
    },
    spaces: lot.spaces.map((space) => ({
      label: space.label,
      polygon: spaceToPolygon(space, lot.canvas),
      backend_space_id: space.backendSpaceId ?? null,
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${lot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-layout.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
