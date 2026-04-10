import EditorCanvas from "./EditorCanvas";
import { spaceToPolygon } from "../utils/geometry";

function buildExportPreview(lot) {
  const exportSpaces = lot.spaces.map((space) => ({
    label: space.label,
    polygon: spaceToPolygon(space, lot.canvas),
  }));

  return JSON.stringify(
    {
      lot: {
        id: lot.id,
        name: lot.name,
        description: lot.description,
        status: lot.status,
      },
      spaces: exportSpaces,
    },
    null,
    2,
  );
}

function clampNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

export default function AdminWorkspace({
  lot,
  onDeleteLot,
  onExportLot,
  onLotChange,
  onSelectSpace,
  selectedSpaceId,
}) {
  const selectedSpace = lot.spaces.find((space) => space.id === selectedSpaceId) ?? null;

  const updateLotField = (field, value) => {
    onLotChange((currentLot) => ({
      ...currentLot,
      [field]: value,
    }));
  };

  const updateSpaceField = (field, value) => {
    if (!selectedSpace) {
      return;
    }

    onLotChange((currentLot) => ({
      ...currentLot,
      spaces: currentLot.spaces.map((space) =>
        space.id === selectedSpace.id
          ? {
              ...space,
              [field]: value,
            }
          : space,
      ),
    }));
  };

  const handleBackgroundUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateLotField("backgroundImage", String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  };

  const handleAddSpace = () => {
    const nextSpaceId = `${lot.id}-space-${Date.now()}`;
    const nextLabel = `P-${String(lot.spaces.length + 1).padStart(2, "0")}`;

    onLotChange((currentLot) => ({
      ...currentLot,
      spaces: [
        ...currentLot.spaces,
        {
          id: nextSpaceId,
          label: nextLabel,
          status: "unknown",
          x: 12 + (currentLot.spaces.length % 5) * 13,
          y: 18 + Math.floor(currentLot.spaces.length / 5) * 16,
          width: 10,
          height: 20,
          rotation: 0,
          confidence: null,
          lastUpdated: null,
        },
      ],
    }));

    onSelectSpace(nextSpaceId);
  };

  const handleDeleteSpace = () => {
    if (!selectedSpace) {
      return;
    }

    onLotChange((currentLot) => ({
      ...currentLot,
      spaces: currentLot.spaces.filter((space) => space.id !== selectedSpace.id),
    }));

    onSelectSpace(null);
  };

  return (
    <div className="workspace-grid">
      <section className="workspace-card workspace-card--editor">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Admin Build Mode</p>
            <h2>{lot.name}</h2>
          </div>
          <div className="toolbar">
            <button className="button button--ghost" onClick={handleAddSpace} type="button">
              Add Space
            </button>
            <button className="button button--ghost" onClick={onExportLot} type="button">
              Export JSON
            </button>
            {lot.source !== "backend" ? (
              <button className="button button--danger" onClick={onDeleteLot} type="button">
                Delete Lot
              </button>
            ) : null}
          </div>
        </div>

        <EditorCanvas
          lot={lot}
          onLotChange={onLotChange}
          onSelectSpace={onSelectSpace}
          selectedSpaceId={selectedSpaceId}
        />
      </section>

      <section className="workspace-card workspace-card--form">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Lot Settings</p>
            <h2>Metadata</h2>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Lot name</span>
            <input
              onChange={(event) => updateLotField("name", event.target.value)}
              type="text"
              value={lot.name}
            />
          </label>

          <label className="field">
            <span>System status</span>
            <select
              onChange={(event) => updateLotField("status", event.target.value)}
              value={lot.status}
            >
              <option value="active">Active</option>
              <option value="monitoring">Monitoring</option>
              <option value="draft">Draft</option>
              <option value="offline">Offline</option>
            </select>
          </label>

          <label className="field field--full">
            <span>Description</span>
            <textarea
              onChange={(event) => updateLotField("description", event.target.value)}
              rows={4}
              value={lot.description}
            />
          </label>

          <label className="field">
            <span>Display region</span>
            <input
              onChange={(event) => updateLotField("region", event.target.value)}
              type="text"
              value={lot.region ?? ""}
            />
          </label>

          <label className="field">
            <span>Background layout</span>
            <input accept="image/*" onChange={handleBackgroundUpload} type="file" />
          </label>
        </div>

        <div className="card-heading card-heading--compact">
          <div>
            <p className="eyebrow">Space Inspector</p>
            <h2>{selectedSpace ? selectedSpace.label : "Select a parking space"}</h2>
          </div>
        </div>

        {selectedSpace ? (
          <div className="form-grid">
            <label className="field">
              <span>Label</span>
              <input
                onChange={(event) => updateSpaceField("label", event.target.value)}
                type="text"
                value={selectedSpace.label}
              />
            </label>

            <label className="field">
              <span>Rotation</span>
              <input
                max="180"
                min="-180"
                onChange={(event) =>
                  updateSpaceField("rotation", clampNumber(event.target.value, 0))
                }
                type="range"
                value={selectedSpace.rotation}
              />
            </label>

            <label className="field">
              <span>X</span>
              <input
                max="100"
                min="0"
                onChange={(event) => updateSpaceField("x", clampNumber(event.target.value, 0))}
                step="0.5"
                type="number"
                value={selectedSpace.x}
              />
            </label>

            <label className="field">
              <span>Y</span>
              <input
                max="100"
                min="0"
                onChange={(event) => updateSpaceField("y", clampNumber(event.target.value, 0))}
                step="0.5"
                type="number"
                value={selectedSpace.y}
              />
            </label>

            <label className="field">
              <span>Width</span>
              <input
                max="100"
                min="4"
                onChange={(event) =>
                  updateSpaceField("width", clampNumber(event.target.value, 10))
                }
                step="0.5"
                type="number"
                value={selectedSpace.width}
              />
            </label>

            <label className="field">
              <span>Height</span>
              <input
                max="100"
                min="4"
                onChange={(event) =>
                  updateSpaceField("height", clampNumber(event.target.value, 20))
                }
                step="0.5"
                type="number"
                value={selectedSpace.height}
              />
            </label>

            <label className="field">
              <span>Preview status</span>
              <select
                onChange={(event) => updateSpaceField("status", event.target.value)}
                value={selectedSpace.status}
              >
                <option value="open">Open</option>
                <option value="occupied">Occupied</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>

            <div className="field field--actions">
              <span>Actions</span>
              <button className="button button--danger" onClick={handleDeleteSpace} type="button">
                Delete Selected Space
              </button>
            </div>
          </div>
        ) : (
          <p className="muted-copy">
            Click any space in the editor to rename it, adjust geometry, or rotate it for diagonal
            parking rows.
          </p>
        )}

        <div className="card-heading card-heading--compact">
          <div>
            <p className="eyebrow">Export Preview</p>
            <h2>Backend-friendly JSON</h2>
          </div>
        </div>
        <textarea className="export-preview" readOnly rows={12} value={buildExportPreview(lot)} />
      </section>
    </div>
  );
}
