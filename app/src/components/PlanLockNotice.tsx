// Turns a refused plan feature (api/client.ts PLAN_LOCK_EVENT — a locked tool, or a write to a
// read-only feature) into the app's ordinary toast, so it says why instead of failing silently.

import { useEffect } from "react";
import { PLAN_LOCK_EVENT } from "../api/client";
import { useAppDispatch } from "../state/store";

export function PlanLockNotice() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const on = (e: Event) => dispatch({ type: "toast", message: `🔒 ${(e as CustomEvent<string>).detail}` });
    window.addEventListener(PLAN_LOCK_EVENT, on);
    return () => window.removeEventListener(PLAN_LOCK_EVENT, on);
  }, [dispatch]);
  return null;
}
