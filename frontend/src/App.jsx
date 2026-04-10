import { useEffect, useMemo, useState } from "react";
import AdminWorkspace from "./components/AdminWorkspace";
import CoverageMap from "./components/CoverageMap";
import HeaderBar from "./components/HeaderBar";
import LotCanvas from "./components/LotCanvas";
import LotSidebar from "./components/LotSidebar";
import { parseRouteFromHash, updateHashRoute } from "./hooks/useHashRoute";
import {
  createLotDraft,
  deleteLotDraft,
  downloadLotExport,
  getLotCatalog,
  getLotDetail,
  saveLotDraft,
} from "./services/parkingService";
import { buildMetrics } from "./utils/geometry";

function App() {
  const [route, setRoute] = useState(() => parseRouteFromHash(window.location.hash));
  const [lots, setLots] = useState([]);
  const [backendHealth, setBackendHealth] = useState({ ok: false, source: "checking" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [lastRefresh, setLastRefresh] = useState("");

  const selectedLot = useMemo(
    () => lots.find((lot) => lot.id === route.lotId) ?? null,
    [lots, route.lotId],
  );

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

      setBackendHealth(catalog.health);
      setLots(catalog.lots);
      setLastRefresh(new Date().toLocaleTimeString());

      const preferredLotId = route.lotId && catalog.lots.some((lot) => lot.id === route.lotId)
        ? route.lotId
        : catalog.lots[0]?.id;

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

    async function refreshCurrentLot({ background = false } = {}) {
      const detail = await getLotDetail(route.lotId);
      if (!detail || cancelled) {
        return;
      }

      setBackendHealth(detail.health);
      setLots((currentLots) => {
        const exists = currentLots.some((lot) => lot.id === detail.lot.id);
        const nextLots = exists
          ? currentLots.map((lot) => (lot.id === detail.lot.id ? detail.lot : lot))
          : [...currentLots, detail.lot];

        return nextLots.sort((left, right) => left.name.localeCompare(right.name));
      });

      if (!background) {
        setLastRefresh(new Date().toLocaleTimeString());
      }
    }

    refreshCurrentLot();
    const intervalId = window.setInterval(
      () => refreshCurrentLot({ background: true }),
      7000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [route.lotId]);

  const handleLotSelect = (lotId) => {
    setSelectedSpaceId(null);
    updateHashRoute({ lotId, mode: route.mode });
  };

  const handleModeChange = (mode) => {
    setSelectedSpaceId(null);
    updateHashRoute({ lotId: route.lotId, mode });
  };

  const handleCreateLot = () => {
    const lot = createLotDraft();
    setLots((currentLots) => [...currentLots, lot].sort((left, right) => left.name.localeCompare(right.name)));
    setSelectedSpaceId(null);
    updateHashRoute({ lotId: lot.id, mode: "admin" });
    setSaveMessage("Created a new local lot draft. Add a background and start laying out spaces.");
  };

  const handleLotChange = (updater) => {
    if (!selectedLot) {
      return;
    }

    setLots((currentLots) =>
      currentLots.map((lot) => {
        if (lot.id !== selectedLot.id) {
          return lot;
        }

        const nextLot = typeof updater === "function" ? updater(lot) : updater;
        return {
          ...nextLot,
          updatedAt: new Date().toISOString(),
          metrics: buildMetrics(nextLot.spaces ?? []),
        };
      }),
    );
  };

  const handleSaveLot = async () => {
    if (!selectedLot) {
      return;
    }

    setIsSaving(true);
    setSaveMessage("");
    const result = await saveLotDraft(selectedLot);
    setLots((currentLots) =>
      currentLots.map((lot) => (lot.id === result.lot.id ? result.lot : lot)),
    );
    setIsSaving(false);
    setSaveMessage(result.message);
  };

  const handleDeleteLot = async () => {
    if (!selectedLot || selectedLot.source === "backend") {
      return;
    }

    await deleteLotDraft(selectedLot.id);
    const remainingLots = lots.filter((lot) => lot.id !== selectedLot.id);
    setLots(remainingLots);
    setSelectedSpaceId(null);
    const fallbackLotId = remainingLots[0]?.id ?? "";
    updateHashRoute({ lotId: fallbackLotId, mode: fallbackLotId ? route.mode : "user" });
    setSaveMessage(`Removed ${selectedLot.name} from local drafts.`);
  };

  const handleExportLot = () => {
    if (!selectedLot) {
      return;
    }
    downloadLotExport(selectedLot);
    setSaveMessage(`Exported ${selectedLot.name} layout JSON for backend integration.`);
  };

  return (
    <div className="app-shell">
      <HeaderBar
        backendHealth={backendHealth}
        isSaving={isSaving}
        mode={route.mode}
        onCreateLot={handleCreateLot}
        onModeChange={handleModeChange}
        onSaveLot={handleSaveLot}
        saveMessage={saveMessage}
      />

      <main className="page-grid">
        <aside className="left-rail">
          <CoverageMap lots={lots} onSelectLot={handleLotSelect} selectedLotId={route.lotId} />
          <LotSidebar
            lots={lots}
            onSelectLot={handleLotSelect}
            selectedLotId={route.lotId}
          />
        </aside>

        <section className="main-panel">
          {isLoading ? (
            <div className="empty-state">
              <h2>Connecting to Parking Spotter</h2>
              <p>Reading the current backend and loading parking lots.</p>
            </div>
          ) : selectedLot ? (
            route.mode === "admin" ? (
              <AdminWorkspace
                lot={selectedLot}
                onDeleteLot={handleDeleteLot}
                onExportLot={handleExportLot}
                onLotChange={handleLotChange}
                onSelectSpace={setSelectedSpaceId}
                selectedSpaceId={selectedSpaceId}
              />
            ) : (
              <LotCanvas
                lastRefresh={lastRefresh}
                lot={selectedLot}
                onEnterAdmin={() => handleModeChange("admin")}
              />
            )
          ) : (
            <div className="empty-state">
              <h2>No parking lots available</h2>
              <p>Create a new lot in admin mode to start building coverage.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
