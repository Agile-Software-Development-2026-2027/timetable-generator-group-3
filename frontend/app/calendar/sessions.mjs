// The largest page the API allows (MAX_PAGE_SIZE in backend/app/timetable.py).
export const SESSION_PAGE_SIZE = 500;
const DEFAULT_CALENDAR_TIME_RANGE = { min: "07:00:00", max: "22:00:00" };

function minutesFromTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00:00`;
}

export function getCalendarTimeRange(sessions) {
  if (!sessions.length) return DEFAULT_CALENDAR_TIME_RANGE;

  const earliest = Math.min(...sessions.map((session) => minutesFromTime(session.start_time)));
  const latest = Math.max(...sessions.map((session) => minutesFromTime(session.end_time)));
  const minHour = Math.max(0, Math.floor(earliest / 60) - 1);
  const maxHour = Math.min(24, Math.ceil(latest / 60) + 1);

  return { min: formatHour(minHour), max: formatHour(maxHour) };
}

// GET /timetable/sessions is paginated, so keep asking until a page comes back short.
export async function fetchAllSessions(request) {
  const sessions = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(`/timetable/sessions?page=${page}&page_size=${SESSION_PAGE_SIZE}`);
    sessions.push(...batch);
    if (batch.length < SESSION_PAGE_SIZE) return sessions;
  }
}
