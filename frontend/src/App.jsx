import { useState, useEffect } from "react";
import "./App.css";
import ParkingGrid from "./ParkingGrid";

const API = "http://127.0.0.1:8080";

function App() {
  const [stats, setStats] = useState(null);
  const [spaces, setSpaces] = useState([]);

  useEffect(() => {
    fetch(`${API}/lots/1/summary`)
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch((err) => console.error("Database connection failed:", err));
  }, []);

  useEffect(() => {
    const fetchOccupancy = () => {
      fetch(`${API}/lots/1/occupancy`)
        .then((res) => res.json())
        .then((data) => setSpaces(data.spaces ?? []))
        .catch((err) => console.error("Occupancy fetch failed:", err));
    };

    fetchOccupancy();
    const id = setInterval(fetchOccupancy, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="dashboard">
      <h1>Parking Spotter - Live Dashboard</h1>
      {stats ? (
        <div className="stats-grid">
          <div className="card">
            <h3>Total Spots</h3>
            <p>{stats.total}</p>
          </div>
          <div className="card available">
            <h3>Available</h3>
            <p>{stats.open}</p>
          </div>
        </div>
      ) : (
        <p>Connecting to Python Backend...</p>
      )}
      <ParkingGrid spaces={spaces} />
    </div>
  );
}

export default App;
