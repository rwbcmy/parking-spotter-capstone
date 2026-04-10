export const BUILTIN_LOCAL_LOTS = [
  {
    id: "north-garage-draft",
    name: "North Garage Draft",
    description: "Editable mock lot used when backend layout CRUD is not available yet.",
    status: "draft",
    source: "local",
    region: "North Campus",
    location: { x: 68, y: 32 },
    backgroundImage: "",
    canvas: { width: 1000, height: 600 },
    spaces: [
      { id: "north-1", label: "N1", status: "open", x: 10, y: 18, width: 10, height: 20, rotation: 0 },
      { id: "north-2", label: "N2", status: "occupied", x: 22, y: 18, width: 10, height: 20, rotation: 0 },
      { id: "north-3", label: "N3", status: "open", x: 34, y: 18, width: 10, height: 20, rotation: 0 },
      { id: "north-4", label: "N4", status: "unknown", x: 46, y: 18, width: 10, height: 20, rotation: 0 },
      { id: "north-5", label: "N5", status: "open", x: 58, y: 18, width: 10, height: 20, rotation: 0 },
      { id: "north-6", label: "N6", status: "occupied", x: 12, y: 54, width: 10, height: 20, rotation: 180 },
      { id: "north-7", label: "N7", status: "open", x: 24, y: 54, width: 10, height: 20, rotation: 180 },
      { id: "north-8", label: "N8", status: "unknown", x: 36, y: 54, width: 10, height: 20, rotation: 180 },
    ],
  },
];
