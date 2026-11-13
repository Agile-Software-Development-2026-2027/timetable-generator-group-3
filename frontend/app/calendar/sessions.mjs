// The largest page the API allows (MAX_PAGE_SIZE in backend/app/timetable.py).
export const SESSION_PAGE_SIZE = 500;
export const DEFAULT_SLOT_CONFIG = {
  working_days: [0, 1, 2, 3, 4],
  start_time: "09:00:00",
  end_time: "18:00:00",
  block_minutes: 60,
};

export function getCalendarWeekSettings(workingDays) {
  const calendarDays = workingDays.map((day) => (day + 1) % 7);
  return {
    firstDay: calendarDays[0] ?? 1,
    hiddenDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => !calendarDays.includes(day)),
  };
}

export function getResponsiveCalendarView(currentView, isCompact) {
  if (currentView === "timeGridWeek" && isCompact) return "listWeek";
  if (currentView === "listWeek" && !isCompact) return "timeGridWeek";
  return null;
}

function minutesFromTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00:00`;
}

export function getCalendarTimeRange(sessions, config = DEFAULT_SLOT_CONFIG) {
  const startMinutes = minutesFromTime(config.start_time);
  const endMinutes = minutesFromTime(config.end_time);
  if (!sessions.length) return { min: config.start_time, max: config.end_time };

  const earliest = Math.min(...sessions.map((session) => minutesFromTime(session.start_time)));
  const latest = Math.max(...sessions.map((session) => minutesFromTime(session.end_time)));
  const minHour = Math.max(0, Math.floor(Math.min(startMinutes, earliest) / 60) - 1);
  const maxHour = Math.min(24, Math.ceil(Math.max(endMinutes, latest) / 60) + 1);

  return {
    min: formatHour(minHour),
    max: formatHour(maxHour),
  };
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
