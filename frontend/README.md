# Timetable Generator Frontend

The frontend is a Next.js application for managing degree programmes and
viewing the weekly timetable.

For project overview and working conventions, see the [root README](../README.md).
For backend setup and API details, see the [backend README](../backend/README.md).

## Requirements

- Node.js and npm
- The backend API running locally or at an accessible URL

## Setup and development

From the `frontend` directory, install dependencies and start the development
server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser. The frontend
uses `http://localhost:8000` as its default backend API URL.

To use a different backend URL, create a `.env.local` file in the `frontend`
directory:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Replace the example URL as needed, then restart the frontend server.

## Pages

- `/` — Manage degree programmes. View the programme list and course counts,
  inspect years and semesters, and create, edit, or delete degrees.
- `/calendar` — View scheduled classes in weekly, daily, or monthly calendar
  views.

## API endpoints used

The degree page uses:

- `GET /degrees` — list degrees
- `POST /degrees` — create a degree
- `GET /degrees/{id}` — view a degree's structure
- `PUT /degrees/{id}` — update a degree
- `DELETE /degrees/{id}` — delete a degree

The calendar page reads from `GET /courses`, `GET /rooms`, and
`GET /timetable/sessions`. Refer to the [backend README](../backend/README.md)
for backend setup and API details.

## Available scripts

```bash
npm run dev    # Start the development server
npm run build  # Build the production application
npm run start  # Serve the production build
```

Run `npm run build` before `npm run start`.
