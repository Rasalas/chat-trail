import { describe, expect, it, vi } from "vitest";
import { claimContentScript } from "./guard";

describe("claimContentScript", () => {
  it("lets only the first live injection register", () => {
    const runtime: { id?: string } = { id: "extension" };
    vi.stubGlobal("chrome", { runtime });
    const scope = {};
    expect(claimContentScript(scope)).toBe(true);
    expect(claimContentScript(scope)).toBe(false);
  });

  it("takes over from a copy orphaned by an extension reload", () => {
    const orphaned: { id?: string } = { id: "extension" };
    vi.stubGlobal("chrome", { runtime: orphaned });
    const scope = {};
    expect(claimContentScript(scope)).toBe(true);
    orphaned.id = undefined;
    vi.stubGlobal("chrome", { runtime: { id: "extension" } });
    expect(claimContentScript(scope)).toBe(true);
  });

  it("registers the message listener once when the bundle is injected twice", async () => {
    const addListener = vi.fn();
    vi.stubGlobal("chrome", { runtime: { id: "extension", onMessage: { addListener } } });
    vi.resetModules();
    await import("./index");
    vi.resetModules();
    await import("./index");
    expect(addListener).toHaveBeenCalledOnce();
  });
});
