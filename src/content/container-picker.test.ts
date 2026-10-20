import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickContainer } from "./container-picker";
import { SELECTION_CANCELLED } from "./controller";

function key(name: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = `<main id="outer"><section id="middle"><div id="inner"><p>text</p></div></section></main>`;
});

describe("pickContainer", () => {
  it("expands with ArrowUp, narrows with ArrowDown and confirms with Enter", async () => {
    const picked = pickContainer();
    document.querySelector("p")!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    key("ArrowUp");
    key("ArrowUp");
    key("ArrowDown");
    key("Enter");
    await expect(picked).resolves.toBe(document.querySelector("#middle"));
    expect(document.documentElement.style.cursor).toBe("");
  });

  it("keeps presses away from the page while selecting", async () => {
    const pageHandler = vi.fn();
    document.querySelector("#inner")!.addEventListener("mousedown", pageHandler);
    const picked = pickContainer();
    const inner = document.querySelector("#inner")!;
    inner.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await expect(picked).resolves.toBe(inner);
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it("cancels on Escape", async () => {
    const picked = pickContainer();
    key("Escape");
    await expect(picked).rejects.toThrow(SELECTION_CANCELLED);
  });
});
