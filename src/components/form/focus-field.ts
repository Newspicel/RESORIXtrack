/** Focuses a form field's control by name inside `scope` (fields carry `data-field`; their ids are generated). */
export function focusField(scope: ParentNode | null | undefined, name: string) {
  scope?.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`)?.focus()
}
