/**
 * Open Stripe (Checkout / Billing Portal) reliably from inside the Adaptive shell.
 *
 * Why: the app runs in a cross-origin iframe. Browsers only allow top-level
 * navigation or a new tab during a short "user activation" window after the click.
 * Creating a Checkout Session takes 1–15s (Stripe via Composio), so by the time
 * the URL arrives `window.top.location` is blocked and any fallback loads Stripe
 * inside the frame — which Stripe refuses (X-Frame-Options: DENY).
 *
 * Fix: open the tab SYNCHRONOUSLY in the click handler, show a holding message,
 * then point it at Stripe when the URL is ready. Not framed → navigate in place.
 */
export function openCheckoutTab(): Window | null {
  let framed = false;
  try {
    framed = window.top !== window;
  } catch {
    framed = true;
  }
  if (!framed) return null;
  try {
    const tab = window.open("", "_blank");
    if (!tab) return null;
    try {
      tab.document.title = "Opening secure checkout…";
      tab.document.body.style.cssText =
        "margin:0;height:100vh;display:grid;place-items:center;background:#0b0b0f;color:#9aa;font:16px system-ui,sans-serif";
      tab.document.body.textContent = "Opening secure Stripe checkout…";
    } catch {
      /* cosmetic only */
    }
    return tab;
  } catch {
    return null;
  }
}

/**
 * Send the pre-opened tab to Stripe, or close it when there is nothing to open.
 * Returns false only when every route was blocked. Never loads Stripe inside
 * the app frame: Stripe refuses to be framed.
 */
export function goToCheckout(tab: Window | null, url: string | null | undefined): boolean {
  if (!url) {
    try {
      tab?.close();
    } catch {
      /* already closed */
    }
    return true;
  }
  if (tab && !tab.closed) {
    tab.location.href = url;
    return true;
  }
  let framed = false;
  try {
    framed = window.top !== window;
  } catch {
    framed = true;
  }
  if (!framed) {
    window.location.assign(url);
    return true;
  }
  try {
    window.top!.location.href = url;
    return true;
  } catch {
    /* blocked: try a new tab */
  }
  try {
    if (window.open(url, "_blank")) return true;
  } catch {
    /* blocked */
  }
  return false;
}
