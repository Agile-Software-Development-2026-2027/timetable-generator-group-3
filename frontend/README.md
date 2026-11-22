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

Copy `.env.example` to `.env.local` in the `frontend` directory and fill it in:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

The Supabase values are shared privately by the project maintainer; without
them the login page explains that login is not configured. Restart the
frontend server after changing `.env.local`.

## Login and roles

Every page except `/login` and `/set-password` needs a signed-in user.
`/login` signs in with Supabase (`signInWithPassword`); the Supabase client in
`lib/supabase.js` keeps the session and refreshes the token. The app then calls
`GET /auth/me` and sends each role to its home page:

| Role     | Home            | Can open                                                                               |
|----------|-----------------|----------------------------------------------------------------------------------------|
| director | `/`             | `/`, `/rooms`, `/courses`, `/calendar`, `/settings`, `/data-loader`, `/teachers`, `/users` |
| teacher  | `/my-schedule`  | `/my-schedule` (placeholder until KAN-58)                                              |
| student  | `/my-timetable` | `/my-timetable` (placeholder until KAN-59)                                             |

Opening another role's page redirects to your own home; no session, an expired
token (`401`) or an account without a role (`403`) redirects to `/login`. Wrong
credentials always show "Email or password is incorrect". The header shows only
your role's links, your email, and a Log out button.

All API calls go through `apiRequest` in `lib/api.js`, which adds
`Authorization: Bearer <access token>`. The rules for redirects and links are in
`lib/auth-rules.js`; `app/components/auth-provider.jsx` applies them on every page.

Invite emails should link to `/set-password`: Supabase signs the invited user in
from the link, and they choose the password they log in with.

## Pages

- `/` — Manage degree programmes. View the programme list and course counts,
  inspect years and semesters, and create, edit, or delete degrees.
- `/calendar` — View scheduled classes by month, week, or day, inspect a class's
  room and teacher details, and generate a timetable for a degree programme.
- `/login` — Log in with email and password.
- `/set-password` — Choose a password after accepting an invite.
- `/my-schedule`, `/my-timetable` — Teacher and student home pages (placeholders).

### Calendar and timetable generation

The Calendar displays saved sessions on a time grid that follows the configured
working days, daily time range, and block length from `SlotConfig`. The default
UniCal grid is Monday–Friday, 09:00–18:00, with 60-minute blocks. You can switch
between monthly, weekly, and daily views, and filter sessions by degree, year,
and semester. By default, the first available degree is selected; choose
“All degree programmes” to combine schedules. Each scheduled block shows the
course, room, and teacher names;
select a class to open its details. Empty slots are visually distinct from
scheduled classes. When no sessions exist for the selected scope, the Calendar
shows an explanatory empty-state message.

A class's color can be customized individually from its details panel; these
preferences are stored in the current browser and do not change the shared
timetable data.

Generating a timetable requires confirmation because it replaces the saved
schedule for the selected degree programme. The result shows the number of
sessions placed and lists any unscheduled courses with readable explanations,
such as the largest lab available and its capacity, a teacher's availability,
or the semester's required hours compared with the grid capacity. The Calendar
refreshes its sessions after generation without a full page reload and keeps
the latest generation summary available in the same browser.

## API endpoints used

The degree page uses:

- `GET /degrees` — list degrees
- `POST /degrees` — create a degree
- `GET /degrees/{id}` — view a degree's structure
- `PUT /degrees/{id}` — update a degree
- `DELETE /degrees/{id}` — delete a degree
The calendar page reads from `GET /degrees`, `GET /courses`, `GET /rooms`,
`GET /slot-config`, and `GET /timetable/sessions`, requesting every page of
sessions so none are left out. It generates timetables with
`POST /timetable/generate`. Refer to the [backend README](../backend/README.md)
for backend setup and API details.

## Available scripts

```bash
npm run dev    # Start the development server
npm run build  # Build the production application
npm run start  # Serve the production build
npm test       # Run the frontend test suite
npm run lint   # Check frontend code with ESLint
```

Run `npm run build` before `npm run start`.
