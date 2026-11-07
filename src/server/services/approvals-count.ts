/** Number of absence requests waiting for the actor's decision (badge in the navigation). */
import { pendingForApprover } from "./absences"
import type { Actor } from "./permissions"

export function pendingApprovalCount(actor: Actor): number {
  return pendingForApprover(actor).length
}
