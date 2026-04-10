const DEFAULT_MODE = "user";

export function parseRouteFromHash(hashValue) {
  const normalizedHash = hashValue.replace(/^#/, "");
  const [pathPart, queryPart] = normalizedHash.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const params = new URLSearchParams(queryPart || "");

  return {
    lotId: segments[1] || "",
    mode: params.get("mode") === "admin" ? "admin" : DEFAULT_MODE,
  };
}

export function updateHashRoute({ lotId, mode }) {
  const normalizedMode = mode === "admin" ? "admin" : DEFAULT_MODE;
  const path = lotId ? `#/lot/${lotId}?mode=${normalizedMode}` : `#/?mode=${normalizedMode}`;

  if (window.location.hash !== path) {
    window.location.hash = path;
  }
}
