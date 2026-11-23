// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Status, Table } from "./data.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const unmount of cleanup.splice(0)) unmount();
  vi.unstubAllGlobals();
});

const columns = ["Name", "Team", "State"];
const rows = [
  [
    "Ada",
    "Core",
    <Status key="a" tone="success">
      Live
    </Status>,
  ],
  [
    "Ben",
    "Web",
    <Status key="b" tone="warning">
      Paused
    </Status>,
  ],
  [
    "Cleo",
    "Core",
    <Status key="c" tone="warning">
      Paused
    </Status>,
  ],
];

function mount(props: Partial<ComponentProps<typeof Table>>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  cleanup.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  act(() => root.render(<Table columns={columns} rows={rows} {...props} />));
  const type = (text: string) => {
    const input = host.querySelector<HTMLInputElement>("input.rk-table-filter")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const choose = (column: number, value: string) => {
    const select = host.querySelector<HTMLSelectElement>(
      `select.rk-table-column-filter[data-column="${column}"]`,
    )!;
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  return {
    host,
    type,
    choose,
    names: () =>
      [...host.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent),
    selects: () => [...host.querySelectorAll<HTMLSelectElement>("select.rk-table-column-filter")],
  };
}

it("keeps a short table without a search box unless asked", () => {
  const view = mount({});
  expect(view.host.querySelector("input.rk-table-filter")).toBeNull();
  expect(view.selects()).toHaveLength(0);
});

it("shows the search box on a short table when searchable", () => {
  const view = mount({ searchable: true });
  expect(view.host.querySelector("input.rk-table-filter")).not.toBeNull();
  view.type("cle");
  expect(view.names()).toEqual(["Cleo"]);
});

it("offers each named column's values as a filter and combines it with the search", () => {
  const view = mount({ searchable: true, filters: [1, 2] });
  const [team, state] = view.selects();
  expect([...team!.options].map((option) => option.textContent)).toEqual([
    "All Team",
    "Core",
    "Web",
  ]);
  expect([...state!.options].map((option) => option.value)).toEqual(["", "Live", "Paused"]);
  expect(team!.getAttribute("aria-label")).toBe("Filter by Team");
  view.choose(1, "Core");
  expect(view.names()).toEqual(["Ada", "Cleo"]);
  view.choose(2, "Paused");
  expect(view.names()).toEqual(["Cleo"]);
  view.choose(2, "");
  view.type("ada");
  expect(view.names()).toEqual(["Ada"]);
});

it("ignores filter columns that do not exist", () => {
  const view = mount({ filters: [7, -1, 1.5] });
  expect(view.selects()).toHaveLength(0);
  expect(view.names()).toEqual(["Ada", "Ben", "Cleo"]);
});
