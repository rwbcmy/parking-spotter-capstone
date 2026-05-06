export default function LotDesignSurface({ compact = false, label = "Parking lot preview" }) {
  return (
    <div className={`lot-design-surface ${compact ? "lot-design-surface--compact" : ""}`} aria-label={label}>
      <div className="lot-design-surface__asphalt" />
    </div>
  );
}
