import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TimetablePage from "../page.jsx";

vi.mock("@fullcalendar/react", () => ({
  default: ({ events, eventContent }) => <div data-testid="calendar-events">
    {events.map((event) => <div key={event.id}>
      {eventContent({ event: { extendedProps: event.extendedProps }, view: { type: "timeGridWeek" } })}
    </div>)}
  </div>,
}));
vi.mock("@fullcalendar/react/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/list", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/breezy", () => ({ default: {} }));

const courses = [
  { id: 11, degree_id: 7, name: "Algorithms", year_id: 101, year: 1, semester_id: 1001, semester: 1 },
  { id: 12, degree_id: 7, name: "Databases", year_id: 101, year: 1, semester_id: 1001, semester: 1 },
  { id: 13, degree_id: 7, name: "Networks", year_id: 102, year: 2, semester_id: 1003, semester: 1 },
  { id: 14, degree_id: 7, name: "Distributed Systems", year_id: 102, year: 2, semester_id: 1003, semester: 1 },
  { id: 21, degree_id: 8, name: "Mechanics", year_id: 201, year: 1, semester_id: 2001, semester: 1 },
];

const degreeStructure = {
  id: 7,
  name: "Computer Science",
  years: [
    { id: 101, number: 1, semesters: [{ id: 1001, number: 1 }, { id: 1002, number: 2 }] },
    { id: 102, number: 2, semesters: [{ id: 1003, number: 1 }, { id: 1004, number: 2 }] },
  ],
};

const sessions = courses.map((course, index) => ({
  id: index + 1,
  course_id: course.id,
  weekday: 0,
  start_time: "09:00:00",
  end_time: "10:00:00",
  room_id: null,
  room_code: course.id === 11 ? "R101" : null,
  teacher_names: course.id === 11 ? ["Ada Lovelace"] : [],
  course_name: course.name,
}));

const response = (data) => Promise.resolve({
  ok: true,
  status: 200,
  text: () => Promise.resolve(JSON.stringify(data)),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("filters calendar sessions by degree, year, and semester", async () => {
  global.fetch = vi.fn((url) => {
    if (url.endsWith("/degrees/7")) return response(degreeStructure);
    if (url.endsWith("/degrees")) return response([
      { id: 7, name: "Computer Science" },
      { id: 8, name: "Physics" },
    ]);
    if (url.endsWith("/courses")) return response(courses);
    if (url.includes("/timetable/sessions")) return response(sessions);
    if (url.endsWith("/slot-config")) return response({
      working_days: [0, 1, 2, 3, 4],
      start_time: "09:00:00",
      end_time: "18:00:00",
      block_minutes: 60,
    });
    return response([]);
  });

  render(<TimetablePage />);

  const degree = await screen.findByRole("combobox", { name: "Filter by degree" });
  const year = screen.getByRole("combobox", { name: "Filter by year" });
  const semester = screen.getByRole("combobox", { name: "Filter by semester" });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringMatching(/\/degrees\/7$/),
    expect.any(Object)
  ));
  await screen.findByRole("option", { name: "Year 1, Semester 2" });

  expect(screen.getByLabelText("Calendar key")).toHaveTextContent("Empty slot");
  expect(screen.getByLabelText("Calendar key")).toHaveTextContent("Scheduled class");
  await waitFor(() => expect(screen.getByTestId("calendar-events")).toHaveTextContent("Algorithms"));
  expect(degree).toHaveValue("7");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("Mechanics");
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("R101");
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Ada Lovelace");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("09:00–10:00");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("Room not assigned");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("Teacher not assigned");
  fireEvent.change(degree, { target: { value: "" } });
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Mechanics");
  fireEvent.change(degree, { target: { value: "7" } });
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Algorithms");
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Databases");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("Mechanics");

  fireEvent.change(year, { target: { value: "101" } });
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Algorithms");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("Networks");
  expect(screen.getByRole("option", { name: "Year 1, Semester 1" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Year 1, Semester 2" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Year 2, Semester 1" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Year 2, Semester 2" })).not.toBeInTheDocument();

  fireEvent.change(semester, { target: { value: "1001" } });
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Databases");
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Algorithms");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("Networks");
  fireEvent.change(semester, { target: { value: "1002" } });
  expect(await screen.findByText("No timetable for this selection")).toBeInTheDocument();

  fireEvent.change(year, { target: { value: "" } });
  expect(screen.getByRole("option", { name: "Year 2, Semester 1" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Year 2, Semester 2" })).toBeInTheDocument();
  fireEvent.change(semester, { target: { value: "1003" } });
  expect(year).toHaveValue("102");
  expect(semester).toHaveValue("1003");
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Distributed Systems");
  expect(screen.getByTestId("calendar-events")).toHaveTextContent("Networks");
  expect(screen.getByTestId("calendar-events")).not.toHaveTextContent("Algorithms");
});

it("searches visible sessions by course, room, or teacher and explains when there are no matches", async () => {
  global.fetch = vi.fn((url) => {
    if (url.endsWith("/degrees/7")) return response(degreeStructure);
    if (url.endsWith("/degrees")) return response([
      { id: 7, name: "Computer Science" },
      { id: 8, name: "Physics" },
    ]);
    if (url.endsWith("/courses")) return response(courses);
    if (url.includes("/timetable/sessions")) return response(sessions);
    if (url.endsWith("/slot-config")) return response({
      working_days: [0, 1, 2, 3, 4],
      start_time: "09:00:00",
      end_time: "18:00:00",
      block_minutes: 60,
    });
    return response([]);
  });

  render(<TimetablePage />);

  const search = await screen.findByRole("searchbox", { name: "Search classes" });
  const events = screen.getByTestId("calendar-events");
  await waitFor(() => expect(events).toHaveTextContent("Algorithms"));

  fireEvent.change(search, { target: { value: "ADA LOVELACE" } });
  expect(events).toHaveTextContent("Algorithms");
  expect(events).not.toHaveTextContent("Databases");

  fireEvent.change(search, { target: { value: "r101" } });
  expect(events).toHaveTextContent("Algorithms");
  expect(events).not.toHaveTextContent("Networks");

  fireEvent.change(search, { target: { value: "databases" } });
  expect(events).toHaveTextContent("Databases");
  expect(events).not.toHaveTextContent("Algorithms");

  fireEvent.change(search, { target: { value: "missing course" } });
  expect(await screen.findByText("No classes match your search")).toBeInTheDocument();
  expect(screen.getByText("Try a different course, teacher, or room.")).toBeInTheDocument();
});

it("explains when no timetable has been generated for the selected degree", async () => {
  global.fetch = vi.fn((url) => {
    if (url.endsWith("/degrees/7")) return response(degreeStructure);
    if (url.endsWith("/degrees")) return response([{ id: 7, name: "Computer Science" }]);
    if (url.endsWith("/courses") || url.endsWith("/rooms")) return response([]);
    if (url.includes("/timetable/sessions")) return response([]);
    if (url.endsWith("/slot-config")) return response({
      working_days: [0, 1, 2, 3, 4],
      start_time: "09:00:00",
      end_time: "18:00:00",
      block_minutes: 60,
    });
    return response([]);
  });

  render(<TimetablePage />);
  fireEvent.change(await screen.findByRole("combobox", { name: "Filter by degree" }), {
    target: { value: "7" },
  });

  expect(await screen.findByText("No timetable has been generated for Computer Science"))
    .toBeInTheDocument();
});
