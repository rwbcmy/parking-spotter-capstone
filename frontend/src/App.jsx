import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch('http://127.0.0.1:5000/lots/1/summary')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error("Database connection failed:", err));
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
    </div>
  );
}

export default App;