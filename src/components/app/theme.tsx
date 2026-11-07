/**
 * Theme preference: System (follows the device), Light or Dark. The choice lives in the rt_theme cookie
 * and in the bootstrap data; the server renders `.light`/`.dark` on <html> for an explicit choice and no
 * class for System, so CSS (prefers-color-scheme) decides without a script and nothing flashes.
 */
import { useQueryClient } from "@tanstack/react-query"
import { Monitor, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"
import { type Bootstrap, bootstrapQuery, useBootstrap } from "@/lib/session"
import type { Theme } from "@/server/fns/session"

export type { Theme }

const THEMES: readonly { value: Theme; icon: typeof Sun }[] = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
]

const isTheme = (v: unknown): v is Theme => THEMES.some((x) => x.value === v)

function useSetTheme() {
  const qc = useQueryClient()
  return (theme: Theme) => {
    const root = document.documentElement
    root.classList.toggle("light", theme === "light")
    root.classList.toggle("dark", theme === "dark")
    // biome-ignore lint/suspicious/noDocumentCookie: tiny preference cookie, read on the server to avoid a flash
    document.cookie =
      theme === "system"
        ? "rt_theme=; path=/; max-age=0; samesite=lax"
        : `rt_theme=${theme}; path=/; max-age=31536000; samesite=lax`
    qc.setQueryData<Bootstrap>(bootstrapQuery.queryKey, (b) => (b ? { ...b, theme } : b))
  }
}

export function ThemeMenu() {
  const t = useT()
  const theme = useBootstrap().theme
  const setTheme = useSetTheme()
  const label = t("nav.theme_is", { mode: t(`nav.theme.${theme}`) })
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} />} />}
        >
          {/* in System mode only CSS knows the effective theme, so both icons render and CSS picks one */}
          <Sun className="dark:hidden" />
          <Moon className="light:hidden" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => isTheme(v) && setTheme(v)}>
          {THEMES.map(({ value, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick>
              <Icon />
              {t(`nav.theme.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
