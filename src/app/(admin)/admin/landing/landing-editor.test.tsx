/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import type { Block } from "~/lib/page-blocks";
import { LayoutEditor } from "./landing-editor";
type LayoutPayload = {
  owner: string;
  blocks: Block[];
};
type LayoutCallbacks = { onSuccess: () => void; onSettled: () => void };
const state = vi.hoisted(() => ({
  blocks: [] as Block[],
  mutate: vi.fn<(payload: LayoutPayload, callbacks: LayoutCallbacks) => void>(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ home: { layout: { invalidate: vi.fn() } } }),
    i18n: {
      languages: {
        useQuery: () => ({ data: [{ code: "en", label: "English" }] }),
      },
    },
    home: {
      layout: { useQuery: () => ({ data: state.blocks, isLoading: false }) },
      setLayout: {
        useMutation: () => ({ mutate: state.mutate, isPending: false }),
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  state.mutate.mockReset();
  state.blocks = [];
});
it("shares admission and exact dirty snapshot between both layout save actions", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <LayoutEditor images={[]} readOnly={false} />
    </NextIntlClientProvider>,
  );
  const saves = () =>
    screen.getAllByRole<HTMLButtonElement>("button", {
      name: en.admin.landing.layout.save,
    });
  expect(saves().every((button) => button.disabled)).toBe(true);
  fireEvent.change(screen.getAllByRole("combobox")[1]!, {
    target: { value: "system:HERO" },
  });
  expect(saves().every((button) => !button.disabled)).toBe(true);
  fireEvent.click(saves()[0]!);
  fireEvent.click(saves()[1]!);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  const [payload, callbacks] = state.mutate.mock.calls[0]!;
  expect(payload.owner).toBe("landing");
  expect(payload.blocks).toHaveLength(1);
  // Failed writes preserve the draft and release only the admission lock.
  act(() => callbacks.onSettled());
  fireEvent.click(saves()[1]!);
  expect(state.mutate).toHaveBeenCalledTimes(2);
  expect(state.mutate.mock.calls[1]![0]).toEqual(payload);
  act(() => {
    callbacks.onSuccess();
    callbacks.onSettled();
  });
  expect(saves().every((button) => button.disabled)).toBe(true);
});

it("follows untouched reads, preserves edited layout and resets ownership before late callbacks", () => {
  const tree = (owner = "landing") => (
    <NextIntlClientProvider locale="en" messages={en}>
      <LayoutEditor owner={owner} images={[]} readOnly={false} />
    </NextIntlClientProvider>
  );
  const page = render(tree());
  state.blocks = [{ id: "server-hero", type: "HERO" }];
  page.rerender(tree());
  expect(screen.getByText(en.admin.landing.layout.blockTypes.HERO)).toBeTruthy();
  fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "system:NEWS" } });
  state.blocks = [];
  page.rerender(tree());
  fireEvent.click(screen.getAllByRole("button", { name: en.admin.landing.layout.save })[0]!);
  const [payload, callbacks] = state.mutate.mock.calls[0]!;
  expect(payload.blocks.map((block) => block.type)).toEqual(["HERO", "NEWS"]);
  page.rerender(tree("page:new"));
  expect(screen.queryByText(en.admin.landing.layout.blockTypes.HERO, { selector: "span.badge-slate" })).toBeNull();
  fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "system:FEATURES" } });
  act(() => { callbacks.onSuccess(); callbacks.onSettled(); });
  fireEvent.click(screen.getAllByRole("button", { name: en.admin.landing.layout.save })[0]!);
  expect(state.mutate.mock.calls[1]![0].owner).toBe("page:new");
  expect(state.mutate.mock.calls[1]![0].blocks.map((block) => block.type)).toEqual(["FEATURES"]);
});
