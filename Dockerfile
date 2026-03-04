services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: parking
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data

  api:
    build: .
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/parking
      - PORT=5000
    ports:
      - "5000:5000"
    depends_on:
      - db

volumes:
  db_data:
