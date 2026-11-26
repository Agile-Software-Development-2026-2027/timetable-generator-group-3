import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StudentCalendar from "../student-calendar.jsx";
const calendar = vi.hoisted(() => ({
  props: null,
  view: { type: "timeGridWeek" },
  changeView: vi.fn(),
}));

vi.mock("@fullcalendar/react", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");

  return {
    default: forwardRef(function CalendarMock(props, ref) {
      calendar.props = props;

      useImperativeHandle(ref, () => ({
        getApi: () => calendar,
      }));

      return (
        <div data-testid="calendar-events">
          {props.events.map((event) => (
            <div key={event.id}>
              {props.eventContent({
                event: { extendedProps: event.extendedProps },
                view: calendar.view,
              })}
            </div>
          ))}
        </div>
      );
    }),
  };
});

vi.mock("@fullcalendar/react/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/list", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/breezy", () => ({ default: {} }));

const session = {
  id: 1,
  course_id: 11,
  course_name: "Databases",
  room_code: "R101",
  teacher_names: ["Ada Lovelace", "Alan Turing"],
  weekday: 0,
  start_time: "09:00:00",
  end_time: "10:30:00",
};

beforeEach(() => {
  calendar.props = null;
  calendar.view.type = "timeGridWeek";
  calendar.changeView.mockReset();
  calendar.changeView.mockImplementation((view) => {
    calendar.view.type = view;
  });
  vi.stubGlobal("innerWidth", 1200);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StudentCalendar", () => {
  it("renders course, room, teacher and time information", () => {
    render(<StudentCalendar sessions={[session]} />);

    expect(screen.getByRole("region", {
      name: "Personal weekly timetable",
    })).toBeInTheDocument();

    expect(screen.getByText("Databases")).toBeInTheDocument();
    expect(screen.getByText("R101")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace, Alan Turing")).toBeInTheDocument();
    expect(screen.getByText("09:00 - 10:30")).toBeInTheDocument();
    expect(screen.getByText("scheduled class")).toBeInTheDocument();
  });

  it("preserves the complete session duration", () => {
    render(<StudentCalendar sessions={[session]} />);

    expect(calendar.props.events[0]).toMatchObject({
      id: "1",
      startTime: "09:00:00",
      endTime: "10:30:00",
    });
  });

  it("maps Monday and Sunday to FullCalendar weekdays", () => {
    render(<StudentCalendar sessions={[
      session,
      { ...session, id: 2, weekday: 6 },
    ]} />);

    expect(calendar.props.events[0].daysOfWeek).toEqual([1]);
    expect(calendar.props.events[1].daysOfWeek).toEqual([0]);
  });

  it("disables all timetable editing operations", () => {
    render(<StudentCalendar sessions={[session]} />);

    expect(calendar.props).toMatchObject({
      editable: false,
      selectable: false,
      eventStartEditable: false,
      eventDurationEditable: false,
      droppable: false,
      allDaySlot: false,
    });

    expect(calendar.props.eventDrop).toBeUndefined();
    expect(calendar.props.eventResize).toBeUndefined();
  });

  it("provides fallback labels for missing session information", () => {
    render(<StudentCalendar sessions={[{
      ...session,
      course_name: null,
      room_code: null,
      teacher_names: [],
    }]} />);

    expect(screen.getByText("Course")).toBeInTheDocument();
    expect(screen.getByText("Room not assigned")).toBeInTheDocument();
    expect(screen.getByText("Teacher not assigned")).toBeInTheDocument();
  });

  it("handles an empty timetable", () => {
    render(<StudentCalendar />);

    expect(calendar.props.events).toEqual([]);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("scheduled classes")).toBeInTheDocument();
  });

  it("keeps scheduled weekend classes visible", () => {
    render(<StudentCalendar sessions={[
      { ...session, weekday: 5 },
      { ...session, id: 2, weekday: 6 },
    ]} />);

    expect(calendar.props.hiddenDays).not.toContain(6);
    expect(calendar.props.hiddenDays).not.toContain(0);
  });

  it("includes sessions outside the normal working hours", () => {
    render(<StudentCalendar sessions={[
      { ...session, start_time: "06:30:00", end_time: "07:30:00" },
      { ...session, id: 2, start_time: "21:00:00", end_time: "22:30:00" },
    ]} />);

    expect(calendar.props.slotMinTime).toBe("05:00:00");
    expect(calendar.props.slotMaxTime).toBe("24:00:00");
  });

  it("uses the configured working days and time range", () => {
    render(<StudentCalendar slotConfig={{
      working_days: [1, 2, 3],
      start_time: "06:00:00",
      end_time: "21:00:00",
      block_minutes: 30,
    }} />);

    expect(calendar.props.firstDay).toBe(2);
    expect(calendar.props.hiddenDays).toEqual([0, 1, 5, 6]);
    expect(calendar.props.slotMinTime).toBe("06:00:00");
    expect(calendar.props.slotMaxTime).toBe("21:00:00");
  });

  it("switches to the weekly agenda on mobile and restores the grid", () => {
    vi.stubGlobal("innerWidth", 500);

    render(<StudentCalendar sessions={[session]} />);

    expect(calendar.changeView).toHaveBeenCalledWith("listWeek");

    vi.stubGlobal("innerWidth", 1200);
    fireEvent(window, new window.Event("resize"));

    expect(calendar.changeView).toHaveBeenLastCalledWith("timeGridWeek");
  });

  it("updates displayed classes when the session data changes", () => {
    const { rerender } = render(
      <StudentCalendar sessions={[session]} />
    );

    rerender(<StudentCalendar sessions={[{
      ...session, id: 2, course_name: "Algorithms",
    }]} />);

    expect(screen.getByText("Algorithms")).toBeInTheDocument();
    expect(screen.queryByText("Databases")).not.toBeInTheDocument();
  });

  it("does not fetch timetable or other API data directly", () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    render(<StudentCalendar sessions={[session]} />);

    expect(request).not.toHaveBeenCalled();
  });
});


describe("Student calendar design", () => {
  it("uses consistent colors for the same course", () => {
    render(<StudentCalendar sessions={[
      session,
      { ...session, id: 2 },
      { ...session, id: 3, course_id: 12 },
    ]} />);

    const [first, second, third] = calendar.props.events;

    expect(first.backgroundColor).toBe(second.backgroundColor);
    expect(first.backgroundColor).not.toBe(third.backgroundColor);
    expect(first.borderColor).toBeTruthy();
    expect(first.textColor).toBeTruthy();
  });

  it("provides week, day and list calendar views", () => {
    render(<StudentCalendar sessions={[session]} />);

    expect(calendar.props.headerToolbar.right)
      .toBe("timeGridWeek,timeGridDay,listWeek");
  });
});
