export default function CoverageMap({ lots, onSelectLot, selectedLotId }) {
  return (
    <section className="panel-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Coverage</p>
          <h2>Supported Lots</h2>
        </div>
      </div>

      <div className="coverage-map">
        <div className="coverage-map__grid" />
        {lots.map((lot) => (
          <button
            className={`map-pin ${lot.id === selectedLotId ? "map-pin--active" : ""}`}
            key={lot.id}
            onClick={() => onSelectLot(lot.id)}
            style={{ left: `${lot.location.x}%`, top: `${lot.location.y}%` }}
            type="button"
          >
            <span>{lot.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
