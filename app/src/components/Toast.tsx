// A brief, auto-dismissing confirmation (e.g. "Added to ‹comparison›").
// Driven by state.toast; clears itself after a short delay.

import { useEffect } from "react";
import { useAppState, useAppDispatch } from "../state/store";

export function Toast() {
  const { toast } = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dispatch({ type: "clearToast" }), 2600);
    return () => clearTimeout(t);
  }, [toast, dispatch]);

  if (!toast) return null;
  return (
    <div className="toast" role="status" onClick={() => dispatch({ type: "clearToast" })}>
      {toast}
    </div>
  );
}
