export default function ParkingGrid({ spaces }) {
  if (spaces.length === 0) {
    return <p className="grid-loading">Loading spots...</p>;
  }

  const available = spaces.filter((s) => !s.occupied).length;

  return (
    <div className="lot-wrapper">
      <div className="lot-header">
        <span className="lot-name">Demo Lot</span>
        <span className="lot-availability">
          <span className="dot available-dot" />
          {available} / {spaces.length} available
        </span>
      </div>

      <div className="lot-surface">
        <div className="lot-row">
          {spaces.map((spot, i) => (
            <div key={spot.space_id} className="spot-cell">
              {i > 0 && <div className="lane-line" />}
              <div className={`spot-bay ${spot.occupied ? "occupied" : "available"}`}>
                <span className="spot-label">{spot.label}</span>
                {spot.occupied && <div className="car-icon">🚗</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="drive-lane">
          <div className="center-line" />
        </div>
      </div>

      <div className="lot-legend">
        <span><span className="swatch available-swatch" /> Open</span>
        <span><span className="swatch occupied-swatch" /> Occupied</span>
      </div>
    </div>
  );
}
