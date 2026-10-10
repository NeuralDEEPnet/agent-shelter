import { test } from "node:test";
import assert from "node:assert/strict";
import { openCheckoutTab, goToCheckout } from "../src/lib/checkout-tab";

test("checkout pre-opens a holding tab synchronously, then navigates that tab; missing URL closes it", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let opened = 0; let closed = false;
  const tab = { document: { title: "", body: { style: { cssText: "" }, textContent: "" } }, location: { href: "" }, closed: false, close: () => { closed = true; } };
  const stub = { top: {}, open: () => { opened++; return tab; } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: stub });
  try {
    const preopened = openCheckoutTab();
    assert.equal(opened, 1); assert.ok(preopened);
    assert.equal(tab.document.title, "Opening secure checkout…");
    assert.ok(goToCheckout(preopened, "https://checkout.stripe.test/example"));
    assert.equal(tab.location.href, "https://checkout.stripe.test/example");
    assert.ok(goToCheckout(preopened, null)); assert.equal(closed, true);
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("blocked framed navigation returns false rather than loading Stripe inside the iframe", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = Object.defineProperty({}, "href", { set() { throw new Error("navigation blocked"); } });
  const stub = { top: { location }, open: () => null, location: { assign: () => { throw new Error("must not navigate the iframe"); } } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: stub });
  try { assert.equal(goToCheckout(null, "https://checkout.stripe.test/example"), false); }
  finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});
