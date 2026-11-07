/**
 * Overlay that adapts to the screen: a side sheet (or centred dialog) from `md` up, a bottom drawer on
 * phones. One structure everywhere: header (title, optional `meta` line such as a status badge), a scrolling
 * body, and a sticky footer with the actions: `footer` on the right (primary last), `footerStart` far left
 * (a quiet destructive action). Paddings: `px-5`, header `py-4`, body `py-4`, footer `py-3` with a hairline.
 * Plain confirmations use ConfirmDialog.
 */
import { lazy, type ReactNode, Suspense, useSyncExternalStore } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  type SheetSize,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

// the drawer library is only needed on phones: its own chunk, fetched when a phone renders a dialog
const PhoneDrawer = lazy(() => import("./responsive-drawer"))

const DIALOG_WIDTH: Record<SheetSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-5xl",
}

const QUERY = "(max-width: 767px)"
const subscribe = (cb: () => void) => {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}

/** Below `md` (phones). False during SSR; overlays render nothing on the server, so no mismatch. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = "sheet",
  size = "md",
  className,
  action,
  meta,
  footerStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** visible under the title; omit to keep it screen-reader only (the title is repeated) */
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** desktop form: side sheet (editors, details) or centred dialog (short decisions) */
  variant?: "sheet" | "dialog"
  /** sheet width by content: confirm/reason `sm`, single-record editors `md`, longer forms `lg`, tables `xl` */
  size?: SheetSize
  className?: string
  /** makes body and footer one native form: a submit button in the footer runs this Action */
  action?: (data: FormData) => void | Promise<void>
  /** a line under the title (status badge, counts) */
  meta?: ReactNode
  /** footer actions on the far left (destructive, quiet) */
  footerStart?: ReactNode
}) {
  const actions =
    footer || footerStart ? (
      <>
        {footerStart ? <div className="mr-auto flex flex-wrap items-center gap-2">{footerStart}</div> : null}
        {footer}
      </>
    ) : null
  const phone = useIsPhone()
  const asForm = (node: ReactNode) =>
    action ? (
      <form action={action} className="contents">
        {node}
      </form>
    ) : (
      node
    )
  const desc = description ?? title
  const srDesc = description ? undefined : "sr-only"
  if (phone) {
    return (
      <Suspense fallback={null}>
        <PhoneDrawer
          open={open}
          onOpenChange={onOpenChange}
          title={title}
          description={desc}
          srDescription={!description}
          className={className}
          footer={actions}
          meta={meta}
          wrap={asForm}
        >
          {children}
        </PhoneDrawer>
      </Suspense>
    )
  }
  if (variant === "dialog") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("gap-0 p-0 shadow-overlay", DIALOG_WIDTH[size])}>
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            <DialogDescription className={srDesc}>{desc}</DialogDescription>
            {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
          </DialogHeader>
          {asForm(
            <>
              <div className={cn("max-h-[70dvh] overflow-y-auto px-5 py-4", className)}>{children}</div>
              {actions ? (
                <DialogFooter className="m-0 flex-row flex-wrap items-center justify-end gap-2 rounded-b-xl border-t px-5 py-3">
                  {actions}
                </DialogFooter>
              ) : null}
            </>,
          )}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size={size} className="gap-0 p-0 shadow-overlay">
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          <SheetDescription className={srDesc}>{desc}</SheetDescription>
          {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
        </SheetHeader>
        {asForm(
          <>
            <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)}>{children}</div>
            {actions ? (
              <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
                {actions}
              </SheetFooter>
            ) : null}
          </>,
        )}
      </SheetContent>
    </Sheet>
  )
}
