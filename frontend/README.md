# Parking Spotter Frontend

Replacement frontend for the Parking Spotter capstone project. This app is built with React + Vite and is designed to work with the existing Flask backend in the repository.

## What it includes

- User-facing live lot browser with coverage map, lot list, and parking space layout view
- Occupancy colors for open, occupied, and unknown spaces
- Polling-based live updates against the current backend occupancy endpoint
- Separate admin build mode for creating and editing lot layouts
- Background image upload, space placement, move, resize, rename, rotate, and delete
- Local draft persistence and JSON export for backend-friendly lot layout data

## Backend integration

The frontend connects to the existing Flask API when available:

- `GET /health`
- `GET /lots/1/occupancy`

Because the current backend does not yet expose lot catalog or lot layout CRUD endpoints, the frontend uses a service layer with local draft storage as a fallback. That keeps the UI functional today while making future backend hookup straightforward.

## Local run

1. Start the backend from the repository root:

```bash
cd app
python app.py
```

2. Start the frontend:

```bash
cd frontend
npm install
npm run dev
```

3. Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

## Optional environment variable

If your backend runs somewhere other than `http://127.0.0.1:8080`, set:

```bash
VITE_API_BASE_URL=http://your-backend-host:port
```

## Notes

- Local admin-created lots are stored in browser `localStorage`
- Layout export produces polygon data that fits the current backend `spaces.polygon` schema direction
- The existing frontend starter files were replaced by the new application structure under `src/components`, `src/services`, `src/data`, `src/hooks`, and `src/utils`
