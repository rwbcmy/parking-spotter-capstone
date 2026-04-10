function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function clampPercent(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function polygonToSpaceRect(points, metadata = {}) {
  const normalizedPoints = Array.isArray(points)
    ? points.map((point) =>
        Array.isArray(point)
          ? { x: Number(point[0]) || 0, y: Number(point[1]) || 0 }
          : { x: Number(point.x) || 0, y: Number(point.y) || 0 },
      )
    : [];

  const fallbackRect = {
    id: metadata.fallbackId || `space-${Date.now()}`,
    label: metadata.fallbackLabel || "Space",
    backendSpaceId: metadata.backendSpaceId ?? null,
    x: 10,
    y: 10,
    width: 10,
    height: 18,
    rotation: 0,
    confidence: metadata.confidence ?? null,
    lastUpdated: metadata.lastUpdated ?? null,
  };

  if (normalizedPoints.length === 0) {
    return fallbackRect;
  }

  const maxX = Math.max(...normalizedPoints.map((point) => point.x));
  const minX = Math.min(...normalizedPoints.map((point) => point.x));
  const maxY = Math.max(...normalizedPoints.map((point) => point.y));
  const minY = Math.min(...normalizedPoints.map((point) => point.y));

  return {
    ...fallbackRect,
    x: (minX / 1000) * 100,
    y: (minY / 600) * 100,
    width: Math.max(((maxX - minX) / 1000) * 100, 6),
    height: Math.max(((maxY - minY) / 600) * 100, 10),
  };
}

export function spaceToPolygon(space, canvas = { width: 1000, height: 600 }) {
  const centerX = ((space.x + space.width / 2) / 100) * canvas.width;
  const centerY = ((space.y + space.height / 2) / 100) * canvas.height;
  const halfWidth = (space.width / 100) * canvas.width * 0.5;
  const halfHeight = (space.height / 100) * canvas.height * 0.5;
  const rotation = toRadians(space.rotation || 0);

  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];

  return corners.map((corner) => ({
    x: Number((centerX + corner.x * Math.cos(rotation) - corner.y * Math.sin(rotation)).toFixed(2)),
    y: Number((centerY + corner.x * Math.sin(rotation) + corner.y * Math.cos(rotation)).toFixed(2)),
  }));
}

export function buildMetrics(spaces) {
  return spaces.reduce(
    (summary, space) => {
      summary.total += 1;
      summary[space.status] += 1;
      return summary;
    },
    { total: 0, open: 0, occupied: 0, unknown: 0 },
  );
}

export function cloneLot(lot) {
  return {
    ...lot,
    location: { ...lot.location },
    canvas: { ...lot.canvas },
    spaces: lot.spaces.map((space) => ({
      ...space,
      polygon: Array.isArray(space.polygon)
        ? space.polygon.map((point) => ({ ...point }))
        : undefined,
    })),
  };
}
