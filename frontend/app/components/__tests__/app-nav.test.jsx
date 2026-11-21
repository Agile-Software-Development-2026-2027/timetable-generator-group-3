import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppNav, NAV_LINKS } from "../app-shell.jsx";

describe("AppNav", () => {
  it.each(NAV_LINKS.map(([href]) => href))("shows every link in the same order on %s", (current) => {
    render(<AppNav current={current} />);
    const actions = within(screen.getByRole("navigation"));
    const labels = actions.getAllByRole("link").map((link) => link.textContent).filter(Boolean);
    expect(labels).toEqual(NAV_LINKS.map(([, label]) => label));

    const active = actions.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", current);
  });
});
