/**
 * File choice styled like the other controls: an outline button opening the system picker, the chosen
 * file's name next to it and a clear button. The native input stays hidden (no browser-specific styling).
 */
import { Paperclip, X } from "lucide-react"
import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"

export function FilePicker({
  id,
  accept,
  file,
  onChange,
  "aria-describedby": describedBy,
}: {
  id?: string
  accept?: string
  file: File | null
  onChange: (file: File | null) => void
  "aria-describedby"?: string
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null)
          e.target.value = ""
        }}
      />
      <Button
        id={id}
        type="button"
        variant="outline"
        aria-describedby={describedBy}
        onClick={() => input.current?.click()}
      >
        <Paperclip data-icon="inline-start" />
        {t("common.choose_file")}
      </Button>
      {file ? (
        <>
          <span className="min-w-0 truncate text-sm">{file.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            intent="negative"
            aria-label={`${t("common.remove")}: ${file.name}`}
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
        </>
      ) : null}
    </div>
  )
}
