export const UNIVERSITY_OF_MISSOURI = {
  lat: 38.9404,
  lng: -92.3276,
  latSpan: 0.0012,
  lngSpan: 0.0018,
};

function clampLatitude(lat) {
  return Math.max(-85, Math.min(85, Number(lat) || UNIVERSITY_OF_MISSOURI.lat));
}

function clampLongitude(lng) {
  const numericLng = Number(lng);
  if (!Number.isFinite(numericLng)) {
    return UNIVERSITY_OF_MISSOURI.lng;
  }

  if (numericLng < -180) {
    return -180;
  }

  if (numericLng > 180) {
    return 180;
  }

  return numericLng;
}

export function normalizeLotLocation(location) {
  if (
    location &&
    Number.isFinite(Number(location.lat)) &&
    Number.isFinite(Number(location.lng))
  ) {
    return {
      lat: clampLatitude(location.lat),
      lng: clampLongitude(location.lng),
      latSpan: Math.max(Number(location.latSpan) || UNIVERSITY_OF_MISSOURI.latSpan, 0.00015),
      lngSpan: Math.max(Number(location.lngSpan) || UNIVERSITY_OF_MISSOURI.lngSpan, 0.00015),
    };
  }

  return { ...UNIVERSITY_OF_MISSOURI };
}

export function getLotLocation(lot) {
  return normalizeLotLocation(lot?.location);
}
