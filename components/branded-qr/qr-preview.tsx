"use client"

import { cn } from "@/lib/utils"

export function QrPreview({
  svg,
  className,
}: {
  svg: string | null
  className?: string
}) {
  if (!svg) {
    return (
      <div
        className={cn(
          "aspect-square w-full max-w-[600px] mx-auto rounded-2xl border border-dashed border-[#E7E7E7] bg-[#FAFAF8] flex items-center justify-center text-center px-6",
          className
        )}
      >
        <p className="text-sm text-muted-foreground">
          Enter a URL and tap <span className="font-semibold text-foreground">Generate QR</span> to preview the
          Infusion&apos;s Jaba emblem.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "w-full max-w-[600px] mx-auto overflow-hidden bg-white",
        className
      )}
    >
      <div
        className="w-full aspect-square [&_svg]:w-full [&_svg]:h-auto [&_svg]:block [&_svg]:mx-auto [&_svg]:max-w-[600px]"
        dangerouslySetInnerHTML={{ __html: svg.replace(/^<\?xml[^>]*>/, "") }}
      />
    </div>
  )
}
