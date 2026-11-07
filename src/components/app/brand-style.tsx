/** Applies the administrator's accent colour (Settings → Branding) by overriding --brand only. */
export function BrandStyle({ accent }: { accent: string }) {
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return null
  return <style>{`:root{--brand:${accent}}`}</style>
}
