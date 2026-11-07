import { useI18n } from "@/lib/i18n"
import type { Json, JsonObject } from "@/lib/json"

function show(v: Json | undefined): string {
  if (v == null || v === "") return "–"
  if (typeof v === "boolean") return v ? "✓" : "✗"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/** Changed fields of a change-log entry as "Field: old → new", plus the reason. */
export function ChangeList({
  item,
  max = 4,
}: {
  item: { changed: string[]; before: JsonObject | null; after: JsonObject | null; reason: string }
  max?: number
}) {
  const { t, has } = useI18n()
  const label = (k: string) => (has(`admin.audit.fields.${k}`) ? t(`admin.audit.fields.${k}`) : k)
  const keys = item.changed.slice(0, max)
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-sm">
      {keys.map((k) => (
        <span key={k} className="truncate">
          <span className="text-muted-foreground">{label(k)}:</span>{" "}
          <span className="tabular">{show(item.before?.[k])}</span>
          <span className="text-muted-foreground"> → </span>
          <span className="tabular">{show(item.after?.[k])}</span>
        </span>
      ))}
      {item.changed.length > max ? (
        <span className="text-xs text-muted-foreground">+{item.changed.length - max}</span>
      ) : null}
      {item.reason ? <span className="truncate text-xs text-muted-foreground italic">{item.reason}</span> : null}
    </div>
  )
}
