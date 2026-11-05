// The largest page the API allows (MAX_PAGE_SIZE in backend/app/timetable.py).
export const SESSION_PAGE_SIZE = 500;

// GET /timetable/sessions is paginated, so keep asking until a page comes back short.
export async function fetchAllSessions(request) {
  const sessions = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(`/timetable/sessions?page=${page}&page_size=${SESSION_PAGE_SIZE}`);
    sessions.push(...batch);
    if (batch.length < SESSION_PAGE_SIZE) return sessions;
  }
}
