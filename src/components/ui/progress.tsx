import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "@/lib/utils"

// the root is the track, so a height or `[&>*]:bg-…` on `className` styles the bar directly
function Progress({ className, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator data-slot="progress-indicator" className="h-full bg-primary transition-[width]" />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
