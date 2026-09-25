import { toast } from "sonner";
import type { Notice, Result } from "@/lib/notice";

/** Every returned notice is rendered — a refusal nobody sees is a silent failure. */
export function showNotices(list: Notice[] | undefined) {
  for (const n of list ?? []) {
    if (n.kind === "info") toast.success(n.title, { description: n.message });
    else if (n.kind === "sign-in") toast(n.title, { description: n.message });
    else toast.warning(n.title, { description: n.message });
  }
}

export function unwrap<T>(r: Result<T>): T | null {
  showNotices(r.notices);
  return r.ok ? r.data : null;
}
