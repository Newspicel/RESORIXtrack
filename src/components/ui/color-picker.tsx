/**
 * Colour choice for teams, projects, absence types and the brand accent: eight preset swatches (a radio
 * group, arrow keys move between them) plus a "custom" swatch opening a picker with a hex field. Values are
 * lowercase `#rrggbb`. No native colour input.
 */
import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { Check, Pipette } from "lucide-react"
import { useId, useState } from "react"
import { HexColorPicker } from "react-colorful"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The same eight presets everywhere, harmonised with the status palette (stored values, not styles). */
export const PRESET_COLORS = [
  { value: "#35a1cc", name: "blue" },
  { value: "#2e9e6b", name: "green" },
  { value: "#d4882b", name: "orange" },
  { value: "#8a63d2", name: "violet" },
  { value: "#d0525b", name: "red" },
  { value: "#3f7fd8", name: "indigo" },
  { value: "#c2a12b", name: "yellow" },
  { value: "#6b7280", name: "grey" },
] as const

const HEX = /^#[0-9a-f]{6}$/

const swatch =
  "relative flex size-8 shrink-0 items-center justify-center rounded-full ring-offset-2 ring-offset-background outline-none transition-shadow duration-150 focus-visible:ring-3 focus-visible:ring-ring/50"

export function ColorPicker({
  value,
  onChange,
  id,
  "aria-labelledby": labelledBy,
  className,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  "aria-labelledby"?: string
  className?: string
}) {
  const { t } = useI18n()
  const current = value.toLowerCase()
  const preset = PRESET_COLORS.some((c) => c.value === current)
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <RadioGroupPrimitive
        id={id}
        value={preset ? current : ""}
        onValueChange={(v) => typeof v === "string" && onChange(v)}
        aria-labelledby={labelledBy}
        className="flex flex-wrap items-center gap-2"
      >
        {PRESET_COLORS.map((c) => (
          <RadioPrimitive.Root
            key={c.value}
            value={c.value}
            aria-label={t(`common.colors.${c.name}`)}
            className={cn(swatch, "data-checked:ring-2 data-checked:ring-foreground")}
            style={{ background: c.value }}
          >
            <RadioPrimitive.Indicator>
              <Check className="size-4 text-white" aria-hidden />
            </RadioPrimitive.Indicator>
          </RadioPrimitive.Root>
        ))}
      </RadioGroupPrimitive>
      <CustomColor value={current} selected={!preset} onChange={onChange} />
    </div>
  )
}

function CustomColor({
  value,
  selected,
  onChange,
}: {
  value: string
  selected: boolean
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const hexId = useId()
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const valid = HEX.test(text)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setText(value)
      }}
    >
      <PopoverTrigger
        aria-label={t("common.colors.custom")}
        aria-pressed={selected}
        className={cn(
          swatch,
          "border border-dashed border-input text-muted-foreground hover:text-foreground",
          selected && "border-solid border-transparent ring-2 ring-foreground",
        )}
        style={selected ? { background: value } : undefined}
      >
        {selected ? <Check className="size-4 text-white" aria-hidden /> : <Pipette className="size-4" aria-hidden />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-3 p-3 shadow-overlay">
        <HexColorPicker
          color={valid ? text : value}
          onChange={(c) => {
            setText(c.toLowerCase())
            onChange(c.toLowerCase())
          }}
          className="rt-colorful"
        />
        <div className="flex items-center gap-2">
          <label htmlFor={hexId} className="text-sm text-muted-foreground">
            {t("common.colors.hex")}
          </label>
          <Input
            id={hexId}
            value={text}
            maxLength={7}
            aria-invalid={valid ? undefined : true}
            className="w-28 font-mono tabular"
            onChange={(e) => {
              const v = e.target.value.toLowerCase()
              setText(v)
              if (HEX.test(v)) onChange(v)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
