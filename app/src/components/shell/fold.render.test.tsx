// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * A folded page renders as a section: one shell, one rail, and its title
 * demoted to a heading. The failure this guards is a page arriving inside
 * another with its own topbar and nav rail underneath it.
 */
vi.mock("../../lib/workspace", () => ({
  useWorkspace: () => ({ loading: false, error: null,
    businesses: [{ id: 5, name: "Farm", type: "farm" }],
    business: { id: 5, name: "Farm", type: "farm" },
    modules: ["herd"], farmId: "farm-1", role: "owner", userId: "u1",
    migrated: true, setBusinessId: vi.fn() }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }), signOut: vi.fn() }));

afterEach(cleanup);

it("gives a folded page one shell and one rail", async () => {
  const { OpsShell, PageHeader } = await import("./OpsShell");
  render(
    <MemoryRouter>
      <OpsShell>
        <PageHeader eyebrow="Farm" title="The host" />
        <OpsShell>
          <PageHeader eyebrow="Farm" title="The section" />
        </OpsShell>
      </OpsShell>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("The host")).toBeTruthy());

  expect(document.querySelectorAll(".ops-shell").length).toBe(1);
  expect(document.querySelectorAll(".rail").length).toBe(1);
  expect(document.querySelectorAll(".topbar").length).toBe(1);

  // The host keeps a page title; the folded one becomes a section heading.
  expect(document.querySelectorAll(".page-header").length).toBe(1);
  expect(document.querySelector(".page-header")!.textContent).toContain("The host");
  expect(document.querySelector(".page-header--section")!.textContent).toContain("The section");
});

it("leaves a page on its own alone", async () => {
  const { OpsShell, PageHeader } = await import("./OpsShell");
  render(
    <MemoryRouter>
      <OpsShell><PageHeader eyebrow="Farm" title="On its own" /></OpsShell>
    </MemoryRouter>,
  );
  expect(document.querySelectorAll(".page-header").length).toBe(1);
  expect(document.querySelector(".page-header--section")).toBeNull();
});
