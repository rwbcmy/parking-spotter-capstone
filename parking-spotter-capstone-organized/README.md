# Parking Spotter Capstone

Organized project structure for the parking spot detection foundation API.

## Structure

- `app/app.py` - Flask API with health, occupancy, summary, and status update endpoints
- `database/schema.sql` - PostgreSQL schema for lots, spaces, and space status
- `database/seed.sql` - Optional seed data for a demo lot and sample spaces
- `Dockerfile` - Python API container definition
- `docker-compose.yml` - Local development stack with Postgres and the API
- `.env.example` - Example environment variables for local runs
- `requirements.txt` - Python dependencies

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

The API runs on port `5000` and Postgres runs on `5432`.

## Suggested next steps

- Add camera ingestion and YOLO inference code under `app/`
- Add tests in a future `tests/` folder
- Split routes and database helpers into separate modules as the project grows
