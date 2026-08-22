import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("chrome", { runtime: { onMessage: { addListener: vi.fn() } } });

const { snapshotHtml } = await import("./index");

describe("snapshotHtml", () => {
  it("strips executable content but keeps visible markup", () => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    document.write(`
      <html>
        <head><title>Chat</title><script>window.token = "s3cr3t";</script></head>
        <body>
          <main><p>Hello evidence</p></main>
          <script type="application/json">{"userToken":"abc"}</script>
          <noscript>enable js</noscript>
          <template><div>hidden</div></template>
        </body>
      </html>
    `);

    const html = snapshotHtml();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<p>Hello evidence</p>");
    expect(html).not.toContain("s3cr3t");
    expect(html).not.toContain("userToken");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("<noscript");
    expect(html).not.toContain("<template");
  });
});
