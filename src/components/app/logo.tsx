import { cn } from "@/lib/utils"

/**
 * Company logo (custom upload under Settings → Branding, otherwise the RESORIX logo) and the product
 * wordmark. `/branding/logo/<variant>` serves the uploaded file or falls back to the bundled SVG.
 */
export function CompanyLogo({ className }: { className?: string }) {
  return (
    <>
      <img src="/branding/logo/dark" alt="" className={cn("h-6 w-auto light:hidden", className)} />
      <img src="/branding/logo/light" alt="" className={cn("hidden h-6 w-auto light:block", className)} />
    </>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-bold tracking-tight", className)}>
      RESORIX<span className="text-brand-bright light:text-brand-ink">track</span>
    </span>
  )
}
