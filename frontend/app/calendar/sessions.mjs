// The largest page the API allows (MAX_PAGE_SIZE in backend/app/timetable.py).
export const SESSION_PAGE_SIZE = 500;
export const DEFAULT_SLOT_CONFIG = {
  working_days: [0, 1, 2, 3, 4],
  start_time: "09:00:00",
  end_time: "18:00:00",
  block_minutes: 30,
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
  const [hours, minutes, seconds = 0] = value.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00:00`;
}

// The calendar always shows at least a full 07:00–20:00 day, widened to whole
// hours if the slot configuration starts earlier or ends later.
export const CALENDAR_DAY_START = "07:00:00";
export const CALENDAR_DAY_END = "20:00:00";

export function getCalendarVisibleRange(config = DEFAULT_SLOT_CONFIG) {
  const start = Math.min(minutesFromTime(CALENDAR_DAY_START), minutesFromTime(config.start_time));
  const end = Math.max(minutesFromTime(CALENDAR_DAY_END), minutesFromTime(config.end_time));
  return { min: formatHour(Math.floor(start / 60)), max: formatHour(Math.min(24, Math.ceil(end / 60))) };
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

const COURSE_COLORS = [
  ["#e8eef8", "#526b9b"],
  ["#eee7f6", "#795d9c"],
  ["#e5f1e9", "#47765c"],
  ["#f7eedc", "#987a3e"],
  ["#f8e5e5", "#a54f4f"],
  ["#e1f0f2", "#437c86"],
];


export function getCourseColors(courseId) {
  return COURSE_COLORS[courseId % COURSE_COLORS.length]
    ?? COURSE_COLORS[0];
}


// KAN-21: minimum travel time for a student group changing rooms.
export const ROOM_TRANSITION_MINUTES = 15;

export function detectSessionConflicts(sessions, courses) {
  const conflicts = new Map();
  const coursesById = new Map(
    courses.map((course) => [course.id, course])
  );

  function addConflict(session, other, type, message) {
    if (!conflicts.has(session.id)) {
      conflicts.set(session.id, []);
    }

    conflicts.get(session.id).push({
      type,
      message,
      relatedSessionId: other.id,
    });
  }

  function addPair(first, second, type, explanation) {
    const firstName = first.course_name
      || coursesById.get(first.course_id)?.name
      || "another session";

    const secondName = second.course_name
      || coursesById.get(second.course_id)?.name
      || "another session";

    addConflict(
      first, second, type,
      `${explanation} Conflicting session: ${secondName}.`
    );

    addConflict(
      second, first, type,
      `${explanation} Conflicting session: ${firstName}.`
    );
  }

  const sessionsByDay = new Map();

  for (const session of sessions) {
    if (!sessionsByDay.has(session.weekday)) {
      sessionsByDay.set(session.weekday, []);
    }

    sessionsByDay.get(session.weekday).push({
      session,
      start: minutesFromTime(session.start_time),
      end: minutesFromTime(session.end_time),
      group: coursesById.get(session.course_id)?.semester_id,
      teachers: new Set(session.teacher_ids ?? []),
    });
  }

  for (const dailySessions of sessionsByDay.values()) {
    dailySessions.sort((a, b) => a.start - b.start);

    for (let i = 0; i < dailySessions.length; i += 1) {
      const first = dailySessions[i];

      for (let j = i + 1; j < dailySessions.length; j += 1) {
        const second = dailySessions[j];

        const gap = second.start - first.end;

        if (gap >= ROOM_TRANSITION_MINUTES) {
          break;
        }

        const a = first.session;
        const b = second.session;

        const overlaps =
          first.start < second.end &&
          second.start < first.end;

        const sameGroup =
          first.group != null &&
          first.group === second.group;

        const assignedRooms =
          a.room_id != null && b.room_id != null;

        const sameRoom =
          assignedRooms && a.room_id === b.room_id;

        if (overlaps) {
          if (sameRoom) {
            addPair(
              a, b, "room_overlap",
              `Room double-booked (${a.room_code || a.room_id}).`
            );
          }

          const sharedTeacher = [...first.teachers].some(
            (id) => second.teachers.has(id)
          );

          if (sharedTeacher) {
            addPair(
              a, b, "teacher_overlap",
              "Teacher has simultaneous sessions."
            );
          }

          if (sameGroup) {
            addPair(
              a, b, "student_group_overlap",
              "Student group has overlapping sessions."
            );
          }
        } else if (
          sameGroup &&
          assignedRooms &&
          !sameRoom &&
          gap < ROOM_TRANSITION_MINUTES
        ) {
          addPair(
            a, b, "room_transition",
            `Room-transition buffer is ${gap} min; at least 15 min required.`
          );
        }
      }
    }
  }

  return conflicts;
}
