export default function AdminMapPanel({
  isDrawingLot,
  isSaving,
  lot,
  lots,
  onCreateLot,
  onDeleteLot,
  onLotChange,
  onSaveLot,
  onSelectLot,
  onToggleDrawing,
  saveMessage,
}) {
  return (
    <aside className="admin-panel">
      <div className="admin-panel__header">
        <div>
          <p>Admin Mode</p>
          <h2>Supported Lots</h2>
        </div>
        <button className="button-secondary" onClick={onCreateLot} type="button">
          New Lot
        </button>
      </div>

      <div className="admin-lot-list">
        {lots.map((entry) => (
          <button
            className={`admin-lot-button ${entry.id === lot?.id ? "admin-lot-button--active" : ""}`}
            key={entry.id}
            onClick={() => onSelectLot(entry.id)}
            type="button"
          >
            {entry.name}
          </button>
        ))}
      </div>

      {lot ? (
        <>
          <div className="admin-form">
            <label>
              <span>Lot name</span>
              <input
                onChange={(event) =>
                  onLotChange((currentLot) => ({
                    ...currentLot,
                    name: event.target.value,
                  }))
                }
                type="text"
                value={lot.name}
              />
            </label>

            <label>
              <span>Camera URL</span>
              <input
                onChange={(event) =>
                  onLotChange((currentLot) => ({
                    ...currentLot,
                    cameraUrl: event.target.value,
                  }))
                }
                placeholder="rtsp://... or camera stream URL"
                type="text"
                value={lot.cameraUrl || ""}
              />
            </label>

            <label className="admin-checkbox">
              <input
                checked={Boolean(lot.isDefault)}
                onChange={(event) =>
                  onLotChange((currentLot) => ({
                    ...currentLot,
                    isDefault: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>Use as default lot</span>
            </label>
          </div>

          <div className="admin-panel__actions">
            <button
              className={isDrawingLot ? "button-primary" : "button-secondary"}
              onClick={onToggleDrawing}
              type="button"
            >
              {isDrawingLot ? "Drawing On" : "Draw Lot On Map"}
            </button>
            <button className="button-primary" disabled={isSaving} onClick={onSaveLot} type="button">
              {isSaving ? "Saving..." : "Save Lot"}
            </button>
            <button className="button-danger" onClick={onDeleteLot} type="button">
              Delete
            </button>
          </div>

          <p className="admin-hint">
            Turn on drawing, drag a rectangle on the satellite map, then edit the diagram below.
          </p>
        </>
      ) : (
        <p className="admin-hint">Create a lot first, then draw it on the map.</p>
      )}

      {saveMessage ? <p className="admin-message">{saveMessage}</p> : null}
    </aside>
  );
}
