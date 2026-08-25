// Paste into the DevTools console of a long chat page (bottom of the thread, freshly opened).
// Records how the provider paginates/virtualises while scrolling, then prints one JSON blob.
// Usage: copy the whole file, paste, wait for "PROBE DONE", copy the printed JSON.
(async () => {
  const SEL = "[data-testid='transcript-row'], [data-message-author-role], user-query, model-response, article, [role='listitem']";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const roots = () => [...document.querySelectorAll(SEL)];
  const idOf = (el) =>
    el.getAttribute("data-message-id") ??
    el.getAttribute("data-index") ??
    el.getAttribute("data-test-render-count") ??
    el.id ??
    el.querySelector("[id]")?.id ??
    el.getAttribute("data-testid") ??
    "";
  const sig = () => roots().map((r) => `${r.tagName}:${idOf(r)}`);
  const desc = (el) => el && { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 120), sh: el.scrollHeight, ch: el.clientHeight };

  let scroller = null;
  for (let el = roots()[0]?.parentElement; el; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { scroller = el; break; }
  }
  if (!scroller) scroller = document.scrollingElement;

  const reqs = [];
  const t0 = performance.now();
  const of = window.fetch;
  window.fetch = function (i, o) { const u = typeof i === "string" ? i : i.url; reqs.push({ t: Math.round(performance.now() - t0), u: u.replace(location.origin, "").slice(0, 160) }); return of.apply(this, arguments); };
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { reqs.push({ t: Math.round(performance.now() - t0), xhr: String(u).replace(location.origin, "").slice(0, 160) }); return xo.apply(this, arguments); };

  const first = roots()[0];
  const attrs = (el) => el && [...el.attributes].map((a) => `${a.name}=${a.value.slice(0, 60)}`);
  const sample = { first: attrs(first), firstInnerIds: first && [...first.querySelectorAll("[id],[data-testid],[data-test-render-count]")].slice(0, 12).map((n) => n.tagName + ":" + (n.id || n.getAttribute("data-testid") || n.getAttribute("data-test-render-count"))) };

  const loadSteps = [];
  for (let i = 0; i < 40; i++) {
    const b = { n: roots().length, sh: scroller.scrollHeight, first: sig()[0] };
    scroller.scrollTop = 0;
    await sleep(1800);
    const a = { n: roots().length, sh: scroller.scrollHeight, st: Math.round(scroller.scrollTop), first: sig()[0] };
    loadSteps.push({ i, b, a });
    if (a.n === b.n && a.sh === b.sh && a.st <= 1 && i > 1) break;
  }

  const walk = [];
  const seen = new Set();
  scroller.scrollTop = 0;
  await sleep(500);
  let prev = -1;
  for (let i = 0; i < 300; i++) {
    const s = sig();
    s.forEach((x) => seen.add(x));
    walk.push({ st: Math.round(scroller.scrollTop), inDom: s.length, uniqueSoFar: seen.size });
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (scroller.scrollTop >= max - 1 && scroller.scrollTop === prev) break;
    prev = scroller.scrollTop;
    scroller.scrollTop = Math.min(max, scroller.scrollTop + Math.floor(scroller.clientHeight * 0.8));
    await sleep(250);
  }
  window.fetch = of;
  XMLHttpRequest.prototype.open = xo;

  const out = { href: location.href, scroller: desc(scroller), sample, loadSteps, reqs: reqs.filter((r) => !/\.(png|jpg|svg|woff|js|css)/.test(r.u || r.xhr)).slice(0, 30), walkSummary: { steps: walk.length, maxInDom: Math.max(...walk.map((w) => w.inDom)), minInDom: Math.min(...walk.map((w) => w.inDom)), unique: seen.size, finalInDom: roots().length }, walkSample: walk.filter((_, i) => i % 5 === 0) };
  console.log("PROBE DONE");
  console.log(JSON.stringify(out));
  if (typeof copy === "function") copy(JSON.stringify(out));
  return out;
})();
