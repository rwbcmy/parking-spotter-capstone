# Parking Spotter Capstone

Organized project structure for the parking spot detection foundation API.

## Structure

- `app/app.py` - Flask API with health, occupancy, summary, and status update endpoints
- `database/schema.sql` - Database schema for lots, spaces, and space status
- `database/seed.sql` - Seed data for a demo lot and sample spaces
- `requirements.txt` - Python dependencies

## Run with Python Virtual Environment

```bash
cd app
python -m venv env
pip install -r requirements.txt
python app.py

To test car detection with yolo12n.pt on CPU: python inference.py
```

The API runs on port `5000`

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

To see live dashboard: http://localhost:5173

## Suggested next steps

- Add camera ingestion and YOLO inference code under `app/`
- Add tests in a future `tests/` folder
- Split routes and database helpers into separate modules as the project grows
