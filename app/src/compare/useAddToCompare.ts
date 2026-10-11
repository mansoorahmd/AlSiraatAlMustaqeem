// A single handler for "✚ Add to Compare", used anywhere an āyah or root shows.
// Adds to the active comparison, keeps the store's active id + badge in sync,
// and raises a toast ("Added to ‹comparison›" / "Already in ‹comparison›").

import { useAppDispatch } from "../state/store";
import { addToActiveCompare } from "./ops";

export function useAddToCompare() {
  const dispatch = useAppDispatch();
  return async (kind: "ayah" | "root", ref: string, label: string | null = null) => {
    const { title, added, setId } = await addToActiveCompare(kind, ref, label);
    dispatch({ type: "setActiveCompare", id: setId });
    dispatch({ type: "bumpCompare" });
    dispatch({ type: "toast", message: `${added ? "Added to" : "Already in"} ${title}` });
  };
}
