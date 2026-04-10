function formatSourceLabel(source) {
  return source === "backend" ? "Live backend" : "Local draft";
}

export default function LotSidebar({ lots, onSelectLot, selectedLotId }) {
  return (
    <section className="panel-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Lot Directory</p>
          <h2>Select a Lot</h2>
        </div>
      </div>

      <div className="lot-list">
        {lots.map((lot) => (
          <button
            className={`lot-card ${lot.id === selectedLotId ? "lot-card--active" : ""}`}
            key={lot.id}
            onClick={() => onSelectLot(lot.id)}
            type="button"
          >
            <div className="lot-card__row">
              <strong>{lot.name}</strong>
              <span className="pill pill--neutral">{formatSourceLabel(lot.source)}</span>
            </div>
            <p>{lot.description}</p>
            <div className="lot-card__metrics">
              <span>{lot.metrics.open} open</span>
              <span>{lot.metrics.occupied} occupied</span>
              <span>{lot.metrics.unknown} unknown</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
