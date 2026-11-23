// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { TableCell } from "./data.js";
import { Status, Table } from "./data.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const unmount of cleanup.splice(0)) unmount();
  vi.unstubAllGlobals();
});

const columns = ["Name", "Team", "State"];
const rows: TableCell[][] = [
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

type TableProps = ComponentProps<typeof Table>;

function mount(props: Partial<TableProps>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  cleanup.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = (next: Partial<TableProps>) =>
    act(() => root.render(<Table columns={columns} rows={rows} {...next} />));
  render(props);
  const select = (column: number) =>
    host.querySelector<HTMLSelectElement>(
      `.rk-table-column-filter[data-column="${column}"] select`,
    );
  return {
    host,
    render,
    select,
    type: (text: string) => {
      const input = host.querySelector<HTMLInputElement>("input.rk-table-filter")!;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    choose: (column: number, value: string) => {
      const element = select(column)!;
      act(() => {
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    options: (column: number) => [...select(column)!.options].map((option) => option.value),
    names: () =>
      [...host.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent),
    filters: () => host.querySelectorAll(".rk-table-column-filter").length,
    count: () => host.querySelector('[role="status"]')?.textContent ?? null,
  };
}

it("keeps a short table without a search box unless asked", () => {
  const view = mount({});
  expect(view.host.querySelector("input.rk-table-filter")).toBeNull();
  expect(view.filters()).toBe(0);
});

it("shows the search box on a short table when searchable", () => {
  const view = mount({ searchable: true });
  expect(view.host.querySelector("input.rk-table-filter")).not.toBeNull();
  view.type("cle");
  expect(view.names()).toEqual(["Cleo"]);
  expect(view.count()).toBe("Showing 1 of 3");
});

it("offers each named column's values as a filter and combines it with the search", () => {
  const view = mount({ searchable: true, filters: [1, 2] });
  expect([...view.select(1)!.options].map((option) => option.textContent)).toEqual([
    "Team: all",
    "Core",
    "Web",
  ]);
  expect(view.options(2)).toEqual(["", "Live", "Paused"]);
  expect(view.select(1)!.getAttribute("aria-label")).toBe("Filter by Team");
  expect(view.count()).toBeNull();
  view.choose(1, "Core");
  expect(view.names()).toEqual(["Ada", "Cleo"]);
  view.choose(2, "Paused");
  expect(view.names()).toEqual(["Cleo"]);
  expect(view.count()).toBe("Showing 1 of 3");
  view.choose(2, "");
  view.type("ada");
  expect(view.names()).toEqual(["Ada"]);
});

it("drops a choice whose value left the rows instead of hiding every row", () => {
  const view = mount({ filters: [2] });
  view.choose(2, "Paused");
  expect(view.names()).toEqual(["Ben", "Cleo"]);
  view.render({ filters: [2], rows: [["Ada", "Core", "Live"]] });
  expect(view.names()).toEqual(["Ada"]);
  expect(view.select(2)!.value).toBe("");
});

it("orders figures by value and leaves out columns it cannot offer as a short list", () => {
  const view = mount({
    columns: ["Year", "", "Id"],
    rows: Array.from({ length: 250 }, (_, index) => [
      String([10, 9, 100, 2][index % 4]),
      "x",
      index,
    ]),
    filters: [0, 1, 2],
  });
  expect(view.options(0)).toEqual(["", "2", "9", "10", "100"]);
  // A blank heading gives the list no name, and 250 distinct ids are a job for the search.
  expect(view.select(1)).toBeNull();
  expect(view.select(2)).toBeNull();
});

it("survives filters a model got wrong", () => {
  const wrong = [
    null,
    "x",
    {},
    [Number.NaN, Number.POSITIVE_INFINITY, -0, 0, 1, 1, "1"],
    [7, -1, 1.5],
  ];
  for (const filters of wrong) {
    const view = mount({ filters: filters as unknown as number[] });
    expect(view.names()).toEqual(["Ada", "Ben", "Cleo"]);
    expect(view.filters()).toBeLessThanOrEqual(2);
  }
});
