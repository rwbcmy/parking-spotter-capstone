function SummaryCard({ label, value, tone }) {
  return (
    <div className={`summary-card summary-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function LotCanvas({ lastRefresh, lot, onEnterAdmin }) {
  return (
    <div className="workspace-grid workspace-grid--viewer">
      <section className="workspace-card workspace-card--viewer">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Live Lot View</p>
            <h2>{lot.name}</h2>
            <p className="muted-copy">{lot.description}</p>
          </div>
          <div className="toolbar toolbar--viewer">
            <span className="pill pill--neutral">{lot.source === "backend" ? "Live API" : "Local draft"}</span>
            <button className="button button--ghost" onClick={onEnterAdmin} type="button">
              Edit Layout
            </button>
          </div>
        </div>

        <div className="summary-grid">
          <SummaryCard label="Open" tone="open" value={lot.metrics.open} />
          <SummaryCard label="Occupied" tone="occupied" value={lot.metrics.occupied} />
          <SummaryCard label="Unknown" tone="unknown" value={lot.metrics.unknown} />
          <SummaryCard label="Total Spaces" tone="neutral" value={lot.metrics.total} />
        </div>

        <div className="viewer-canvas">
          {lot.backgroundImage ? (
            <img alt={`${lot.name} layout`} className="viewer-background" src={lot.backgroundImage} />
          ) : (
            <div className="viewer-placeholder">
              <h3>No lot image uploaded</h3>
              <p>The geometry still renders below, so the lot can be demoed before an image is ready.</p>
            </div>
          )}

          <div className="editor-overlay">
            {lot.spaces.map((space) => (
              <div
                className={`parking-space parking-space--viewer parking-space--${space.status}`}
                key={space.id}
                style={{
                  left: `${space.x}%`,
                  top: `${space.y}%`,
                  width: `${space.width}%`,
                  height: `${space.height}%`,
                  transform: `rotate(${space.rotation}deg)`,
                }}
              >
                <span>{space.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="legend-row">
          <span className="legend-pill legend-pill--open">Open</span>
          <span className="legend-pill legend-pill--occupied">Occupied</span>
          <span className="legend-pill legend-pill--unknown">Unknown</span>
          <span className="legend-meta">Last refresh: {lastRefresh || "Waiting for first sync"}</span>
        </div>
      </section>

      <section className="workspace-card workspace-card--insights">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Lot Profile</p>
            <h2>Presentation Details</h2>
          </div>
        </div>

        <div className="detail-list">
          <div className="detail-list__item">
            <span>Region</span>
            <strong>{lot.region || "Campus core"}</strong>
          </div>
          <div className="detail-list__item">
            <span>Lot status</span>
            <strong>{lot.status}</strong>
          </div>
          <div className="detail-list__item">
            <span>Data source</span>
            <strong>{lot.source === "backend" ? "SQLite + Flask API" : "Frontend draft store"}</strong>
          </div>
          <div className="detail-list__item">
            <span>Update model</span>
            <strong>{lot.source === "backend" ? "7 second polling" : "Static draft state"}</strong>
          </div>
        </div>

        <div className="space-list">
          {lot.spaces.map((space) => (
            <div className="space-list__item" key={space.id}>
              <span>{space.label}</span>
              <strong className={`status-text status-text--${space.status}`}>{space.status}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
