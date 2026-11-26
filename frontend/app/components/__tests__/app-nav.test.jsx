import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppNav } from "../app-shell.jsx";
import { AuthContext } from "../auth-provider.jsx";
import { NAV_LINKS_BY_ROLE } from "../../../lib/auth-rules.js";

function renderNav(current, auth) {
  return render(<AuthContext.Provider value={auth}><AppNav current={current} /></AuthContext.Provider>);
}

const signedIn = (role) => ({ status: "signed-in", role, email: `${role}@unical.it`, logOut: vi.fn() });

const linkLabels = () => within(screen.getByRole("navigation")).getAllByRole("link")
  .map((link) => link.textContent).filter(Boolean);

describe("AppNav", () => {
  it.each(NAV_LINKS_BY_ROLE.director.map(([href]) => href))("shows every director link in the same order on %s", (current) => {
    renderNav(current, signedIn("director"));
    expect(linkLabels()).toEqual(NAV_LINKS_BY_ROLE.director.map(([, label]) => label));

    const active = within(screen.getByRole("navigation")).getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", current);
  });

  it("shows a teacher only My schedule", () => {
    renderNav("/my-schedule", signedIn("teacher"));
    expect(linkLabels()).toEqual(["My schedule"]);
    expect(screen.getByRole("link", { name: "University of Calabria" })).toHaveAttribute("href", "/my-schedule");
  });

  it("shows a student My timetable and My courses", () => {
    renderNav("/my-timetable", signedIn("student"));
    expect(linkLabels()).toEqual(["My timetable", "My courses"]);
    expect(screen.getByRole("link", { name: "University of Calabria" })).toHaveAttribute("href", "/my-timetable");
  });

  it.each(["teacher", "student"])("never shows backoffice links to a %s", (role) => {
    renderNav(undefined, signedIn(role));
    for (const [, label] of NAV_LINKS_BY_ROLE.director) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("shows the user's email and logs out", () => {
    const auth = signedIn("teacher");
    renderNav("/my-schedule", auth);
    expect(screen.getByText("teacher@unical.it")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(auth.logOut).toHaveBeenCalledTimes(1);
  });

  it("shows no links, email or Log out when nobody is signed in", () => {
    renderNav(undefined, { status: "signed-out", logOut: vi.fn() });
    expect(linkLabels()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
  });
});


describe("Student course navigation", () => {
  it("highlights My courses when that page is active", () => {
    renderNav("/my-courses", signedIn("student"));

    expect(screen.getByRole("link", { name: "My courses" }))
      .toHaveAttribute("aria-current", "page");

    expect(screen.getByRole("link", { name: "My timetable" }))
      .not.toHaveAttribute("aria-current");
  });

  it.each(["director", "teacher"])(
    "does not show My courses to a %s",
    (role) => {
      renderNav(undefined, signedIn(role));
      expect(screen.queryByRole("link", { name: "My courses" }))
        .not.toBeInTheDocument();
    }
  );
});
