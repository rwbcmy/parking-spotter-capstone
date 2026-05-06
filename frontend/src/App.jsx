import { useEffect, useMemo, useState } from "react";
import AdminMapPanel from "./components/AdminMapPanel";
import CoverageMap from "./components/CoverageMap";
import LotDiagramPanel from "./components/LotDiagramPanel";
import LotLayoutEditor from "./components/LotLayoutEditor";
import { parseRouteFromHash, updateHashRoute } from "./hooks/useHashRoute";
import {
  createLotDraft,
  deleteLotDraft,
  getLotCatalog,
  getLotDetail,
  getLotOccupancy,
  mergeLotOccupancyState,
  mergeLotLiveState,
  saveLotDraft,
} from "./services/parkingService";

const LOT_OCCUPANCY_REFRESH_INTERVAL_MS = 500;
const LOT_DETAIL_REFRESH_INTERVAL_MS = 15000;

function App() {
  const [route, setRoute] = useState(() => parseRouteFromHash(window.location.hash));
  const [lots, setLots] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDrawingLot, setIsDrawingLot] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const focusedLot = useMemo(
    () => lots.find((lot) => lot.id === route.lotId) ?? null,
    [lots, route.lotId],
  );

  const defaultLot = useMemo(
    () => lots.find((lot) => lot.isDefault) ?? lots.find((lot) => lot.source === "backend") ?? lots[0] ?? null,
    [lots],
  );

  const selectedLot = route.mode === "admin" ? (focusedLot ?? defaultLot) : focusedLot;

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRouteFromHash(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setIsLoading(true);
      const catalog = await getLotCatalog();
      if (cancelled) {
        return;
      }

      setLots(catalog.lots);

      const preferredLotId = route.mode === "admin" ? (route.lotId || catalog.lots[0]?.id || "") : route.lotId;
      if (preferredLotId && preferredLotId !== route.lotId) {
        updateHashRoute({ lotId: preferredLotId, mode: route.mode });
      }

      setIsLoading(false);
    }

    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!route.lotId) {
      return undefined;
    }

    let cancelled = false;
    const isBackendLot = route.lotId.startsWith("backend-lot-");
    const backendLotId = isBackendLot ? Number(route.lotId.replace("backend-lot-", "")) : null;
    let detailRequestInFlight = false;
    let occupancyRequestInFlight = false;

    async function refreshCurrentLotDetail() {
      if (detailRequestInFlight) {
        return;
      }

      detailRequestInFlight = true;
      let detail = null;

      try {
        detail = await getLotDetail(route.lotId);
      } finally {
        detailRequestInFlight = false;
      }

      if (!detail || cancelled) {
        return;
      }

      setLots((currentLots) => {
        const existingLot = currentLots.find((lot) => lot.id === detail.lot.id);
        if (!existingLot) {
          return [...currentLots, detail.lot];
        }

        const nextLot =
          route.mode === "admin" && existingLot.source === "backend" && detail.lot.source === "backend"
            ? mergeLotLiveState(existingLot, detail.lot)
            : detail.lot;

        return currentLots.map((lot) => (lot.id === detail.lot.id ? nextLot : lot));
      });
    }

    async function refreshCurrentLotOccupancy() {
      if (!Number.isFinite(backendLotId) || occupancyRequestInFlight) {
        return;
      }

      occupancyRequestInFlight = true;
      let occupancy = null;

      try {
        occupancy = await getLotOccupancy(backendLotId);
      } finally {
        occupancyRequestInFlight = false;
      }

      if (!occupancy || cancelled) {
        return;
      }

      setLots((currentLots) =>
        currentLots.map((lot) =>
          lot.id === route.lotId ? mergeLotOccupancyState(lot, occupancy) : lot,
        ),
      );
    }

    refreshCurrentLotDetail();

    if (isBackendLot) {
      refreshCurrentLotOccupancy();
      const occupancyIntervalId = window.setInterval(
        refreshCurrentLotOccupancy,
        LOT_OCCUPANCY_REFRESH_INTERVAL_MS,
      );
      const detailIntervalId = window.setInterval(
        refreshCurrentLotDetail,
        LOT_DETAIL_REFRESH_INTERVAL_MS,
      );

      return () => {
        cancelled = true;
        window.clearInterval(occupancyIntervalId);
        window.clearInterval(detailIntervalId);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [route.lotId, route.mode]);

  const handleLotSelect = (lotId) => {
    updateHashRoute({ lotId, mode: route.mode });
  };

  const handleModeChange = (mode) => {
    updateHashRoute({ lotId: selectedLot?.id ?? "", mode });
  };

  const handleLotChange = (updater) => {
    if (!selectedLot) {
      return;
    }

    setLots((currentLots) => {
      const nextLots = currentLots.map((lot) =>
        lot.id === selectedLot.id ? (typeof updater === "function" ? updater(lot) : updater) : lot,
      );
      const updatedLot = nextLots.find((lot) => lot.id === selectedLot.id);

      if (!updatedLot?.isDefault) {
        return nextLots;
      }

      return nextLots.map((lot) =>
        lot.id === updatedLot.id ? lot : { ...lot, isDefault: false },
      );
    });
  };

  const handleCreateLot = () => {
    const lot = createLotDraft();
    setLots((currentLots) => [...currentLots, lot]);
    updateHashRoute({ lotId: lot.id, mode: "admin" });
    setSaveMessage("Created a new lot. Click on the map to place it.");
  };

  const handleSaveLot = async () => {
    if (!selectedLot) {
      return;
    }

    setIsSaving(true);
    setSaveMessage("");
    try {
      const previousLotId = selectedLot.id;
      const result = await saveLotDraft(selectedLot);
      setLots((currentLots) => {
        const nextLots = currentLots.some((lot) => lot.id === result.lot.id)
          ? currentLots.map((lot) => (lot.id === result.lot.id ? result.lot : lot))
          : currentLots.map((lot) => (lot.id === previousLotId ? result.lot : lot));

        if (!result.lot.isDefault) {
          return nextLots;
        }

        return nextLots.map((lot) =>
          lot.id === result.lot.id ? lot : { ...lot, isDefault: false },
        );
      });
      if (previousLotId !== result.lot.id) {
        updateHashRoute({ lotId: result.lot.id, mode: "admin" });
      }
      setSaveMessage(result.message);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to save lot changes.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteLot = async () => {
    if (!selectedLot) {
      return;
    }

    await deleteLotDraft(selectedLot.id);
    const remainingLots = lots.filter((lot) => lot.id !== selectedLot.id);
    setLots(remainingLots);
    updateHashRoute({ lotId: remainingLots[0]?.id ?? "", mode: remainingLots[0] ? "admin" : "user" });
    setSaveMessage("Removed lot draft.");
  };

  const handleLotBoundsDraw = (location) => {
    if (route.mode !== "admin" || !selectedLot) {
      return;
    }

    handleLotChange((currentLot) => ({
      ...currentLot,
      location,
    }));
    setIsDrawingLot(false);
  };

  const closeDiagram = () => {
    updateHashRoute({ lotId: "", mode: "user" });
  };

  return (
    <div className="map-app">
      <div className="map-toolbar">
        <div className="map-toolbar__title">
          <strong>Parking Spotter</strong>
          <span>{route.mode === "admin" ? "Admin mode" : "Select a lot"}</span>
        </div>

        <div className="map-toolbar__actions">
          <button
            className={route.mode === "user" ? "mode-button mode-button--active" : "mode-button"}
            onClick={() => handleModeChange("user")}
            type="button"
          >
            User
          </button>
          <button
            className={route.mode === "admin" ? "mode-button mode-button--active" : "mode-button"}
            onClick={() => handleModeChange("admin")}
            type="button"
          >
            Admin
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="map-loading">Loading lots...</div>
      ) : (
        <div className="map-stage">
          <CoverageMap
            emphasisLotId={defaultLot?.id ?? ""}
            isDrawingLot={isDrawingLot}
            lots={lots}
            mode={route.mode}
            onLotDraw={handleLotBoundsDraw}
            onSelectLot={handleLotSelect}
            selectedLotOverlay={
              route.mode === "user" && selectedLot ? (
                <LotDiagramPanel lot={selectedLot} onClose={closeDiagram} />
              ) : null
            }
            selectedLotId={route.lotId}
          />

          {route.mode === "admin" ? (
            <>
              <AdminMapPanel
                isDrawingLot={isDrawingLot}
                isSaving={isSaving}
                lot={selectedLot}
                lots={lots}
                onCreateLot={handleCreateLot}
                onDeleteLot={handleDeleteLot}
                onLotChange={handleLotChange}
                onSaveLot={handleSaveLot}
                onSelectLot={handleLotSelect}
                onToggleDrawing={() => setIsDrawingLot((currentValue) => !currentValue)}
                saveMessage={saveMessage}
              />
              {selectedLot ? (
                <LotLayoutEditor key={selectedLot.id} lot={selectedLot} onLotChange={handleLotChange} />
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default App;
