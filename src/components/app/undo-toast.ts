import { toast } from "sonner"

/** "Done – Undo" toast for reversible actions (soft delete, cancel). */
export function undoToast(message: string, undoLabel: string, onUndo: () => unknown) {
  toast.success(message, { action: { label: undoLabel, onClick: () => void onUndo() }, duration: 8000 })
}
