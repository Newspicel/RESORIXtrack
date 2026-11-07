import { qrMatrix, qrPath } from "./qr"

/** The enrolment QR code (otpauth URI) as a crisp SVG on white, for any theme. */
export default function QrCode({ value, label }: { value: string; label: string }) {
  const { d, size } = qrPath(qrMatrix(value))
  return (
    <div className="w-fit rounded-lg bg-white p-2 text-black">
      <svg viewBox={`0 0 ${size} ${size}`} className="size-48" aria-label={label} shapeRendering="crispEdges">
        <title>{label}</title>
        <path d={d} fill="currentColor" />
      </svg>
    </div>
  )
}
