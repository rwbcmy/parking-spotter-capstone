export default function HeaderBar({
  backendHealth,
  isSaving,
  mode,
  onCreateLot,
  onModeChange,
  onSaveLot,
  saveMessage,
}) {
  const healthTone = backendHealth.ok ? "pill--good" : "pill--warn";
  const healthLabel = backendHealth.ok ? "Backend connected" : "Fallback data mode";

  return (
    <header className="hero-shell">
      <div className="hero-copy">
        <p className="eyebrow">Parking Spotter</p>
        <h1>Live parking map and lot editor</h1>
        <p className="hero-text">
          Browse covered lots in user mode or switch into build mode to create and maintain the
          spatial layouts that power occupancy tracking.
        </p>
      </div>

      <div className="hero-controls">
        <div className="toggle-group">
          <button
            className={mode === "user" ? "toggle-group__button is-active" : "toggle-group__button"}
            onClick={() => onModeChange("user")}
            type="button"
          >
            User View
          </button>
          <button
            className={mode === "admin" ? "toggle-group__button is-active" : "toggle-group__button"}
            onClick={() => onModeChange("admin")}
            type="button"
          >
            Admin Build Mode
          </button>
        </div>

        <div className="hero-actions">
          <span className={`pill ${healthTone}`}>{healthLabel}</span>
          <button className="button button--ghost" onClick={onCreateLot} type="button">
            New Lot
          </button>
          <button className="button" disabled={isSaving} onClick={onSaveLot} type="button">
            {isSaving ? "Saving..." : "Save Draft"}
          </button>
        </div>

        {saveMessage ? <p className="hero-note">{saveMessage}</p> : null}
      </div>
    </header>
  );
}
