/** Lively multi-color category glyphs for the menu marquee */

type IconProps = { className?: string }

export function IconAll({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="4" y="4" width="10" height="10" rx="2.5" fill="#D9843B" />
      <rect x="18" y="4" width="10" height="10" rx="2.5" fill="#E8C17A" />
      <rect x="4" y="18" width="10" height="10" rx="2.5" fill="#7CB87A" />
      <rect x="18" y="18" width="10" height="10" rx="2.5" fill="#C45C4A" />
    </svg>
  )
}

export function IconWhiskey({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M8 10h16v2.5c0 .8-.3 1.5-.8 2.1L22 16.5V26a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-9.5l-1.2-1.9A3 3 0 0 1 8 12.5V10Z"
        fill="#D9843B"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M10 10V8.5c0-.8.7-1.5 1.5-1.5h9c.8 0 1.5.7 1.5 1.5V10" stroke="#2C2118" strokeWidth="1.2" />
      <rect x="12" y="14" width="7" height="6" rx="1.2" fill="#F5EBDC" stroke="#2C2118" strokeWidth="1" />
      <path d="M10 20h12" stroke="#B86A28" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

export function IconGin({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M12 6h8l1 4v14a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V10l1-4Z"
        fill="#E8F0E8"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <rect x="12.5" y="12" width="7" height="8" rx="1" fill="#3D7A4A" stroke="#2C2118" strokeWidth="0.9" />
      <circle cx="8" cy="22" r="2.2" fill="#7B5EA7" stroke="#2C2118" strokeWidth="0.9" />
      <circle cx="11" cy="25" r="1.6" fill="#9B7BC4" stroke="#2C2118" strokeWidth="0.8" />
      <path d="M24 10c1.5 2 1.5 4 0 6" stroke="#5A8F4A" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M22 12c1.2 1.2 1.2 2.8 0 4" stroke="#7CB87A" strokeWidth="1.2" strokeLinecap="round" />
      <ellipse cx="24.5" cy="11" rx="2" ry="1.2" fill="#5A8F4A" stroke="#2C2118" strokeWidth="0.7" />
    </svg>
  )
}

export function IconVodka({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="5" y="8" width="7" height="16" rx="2" fill="#C8D0D8" stroke="#2C2118" strokeWidth="1.1" />
      <path d="M6.5 10h4M6.5 13h4M6.5 16h4" stroke="#8A949E" strokeWidth="1" strokeLinecap="round" />
      <path
        d="M16 5h6l.8 3.5V25a2.5 2.5 0 0 1-2.5 2.5h-2.6A2.5 2.5 0 0 1 15.2 25V8.5L16 5Z"
        fill="#F5EBDC"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <rect x="16.2" y="12" width="5.6" height="7" rx="0.8" fill="#C45C4A" stroke="#2C2118" strokeWidth="0.9" />
      <rect x="17.5" y="5" width="3" height="2.5" rx="0.4" fill="#D9843B" stroke="#2C2118" strokeWidth="0.7" />
    </svg>
  )
}

export function IconBeer({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M6 10h7v14.5A2.5 2.5 0 0 1 10.5 27h0A2.5 2.5 0 0 1 8 24.5V10Z"
        fill="#8B5A2B"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <rect x="7" y="7" width="5" height="3.5" rx="0.6" fill="#D9843B" stroke="#2C2118" strokeWidth="0.9" />
      <path
        d="M16 11h9v1.5c0 .6-.2 1.1-.6 1.5L23.5 15v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V15l-.9-1c-.4-.4-.6-.9-.6-1.5V11Z"
        fill="#E8B84A"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M16.5 11c.8-2 2.5-3 4-3s3.2 1 4 3" fill="#F5EBDC" stroke="#2C2118" strokeWidth="1" />
      <path d="M17.5 18h6M17.5 21h6" stroke="#C9982E" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  )
}

export function IconCider({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="10" cy="18" r="6.5" fill="#C45C4A" stroke="#2C2118" strokeWidth="1.2" />
      <path d="M10 11.5c0-1 .6-2 1.5-2.5" stroke="#5A8F4A" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="12.5" cy="10.5" rx="2.2" ry="1.3" fill="#7CB87A" stroke="#2C2118" strokeWidth="0.8" />
      <path
        d="M18 6h7l.7 3V24a2.5 2.5 0 0 1-2.5 2.5h-3A2.5 2.5 0 0 1 17.7 24V9L18 6Z"
        fill="#F5EBDC"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <rect x="18.4" y="11" width="6.2" height="7" rx="0.8" fill="#E09040" stroke="#2C2118" strokeWidth="0.9" />
      <circle cx="21.5" cy="14.5" r="1.6" fill="#C45C4A" stroke="#2C2118" strokeWidth="0.7" />
    </svg>
  )
}

export function IconTequila({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M8 22 5 10h4l1.2 4.5L12 8h3l1.8 6.5L18 10h4l-3 12H8Z"
        fill="#5A8F4A"
        stroke="#2C2118"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M11 22v3M14 22v4M17 22v3" stroke="#3D6B3A" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M21 14h7v1c0 .5-.2.9-.5 1.2L26.5 17.5V26a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-8.5L20.5 16.2c-.3-.3-.5-.7-.5-1.2v-1Z"
        fill="#E8C17A"
        stroke="#2C2118"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M22 20h5" stroke="#D9843B" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  )
}

export function IconWine({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M10 5h12l-1.5 9.5A6.5 6.5 0 0 1 14 21h0a6.5 6.5 0 0 1-6.5-6.5L10 5Z"
        fill="#6B2D3C"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M16 21v5" stroke="#2C2118" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11 27h10" stroke="#2C2118" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11 12h10" stroke="#8B3D4E" strokeWidth="1" opacity="0.7" />
    </svg>
  )
}

export function IconCocktail({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M7 7h18l-9 11v7h4v2H12v-2h4v-7L7 7Z"
        fill="#E8A0B0"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 9h14" stroke="#F5EBDC" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <circle cx="22" cy="8" r="2.5" fill="#C45C4A" stroke="#2C2118" strokeWidth="0.9" />
      <path d="M20 6.5c1-1.5 2.5-1.5 3.5 0" stroke="#5A8F4A" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

export function IconSoft({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M11 6h10l1 4v15a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V10l1-4Z"
        fill="#5B9BD5"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M12 14c2 2 6 2 8 0" stroke="#F5EBDC" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <circle cx="16" cy="20" r="2.5" fill="#F5EBDC" stroke="#2C2118" strokeWidth="0.8" opacity="0.9" />
      <rect x="13.5" y="4" width="5" height="2.5" rx="0.5" fill="#D9843B" stroke="#2C2118" strokeWidth="0.8" />
    </svg>
  )
}

export function IconEnergy({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M11 5h10l1 3v17a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V8l1-3Z"
        fill="#2E241B"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M15 10 12 17h3.5L14 24l7-10h-3.5L20 10H15Z" fill="#E8C17A" stroke="#D9843B" strokeWidth="0.8" strokeLinejoin="round" />
    </svg>
  )
}

export function IconJaba({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <ellipse cx="16" cy="20" rx="9" ry="7" fill="#7CB87A" stroke="#2C2118" strokeWidth="1.2" />
      <path d="M16 6c0 4 2 7 2 10" stroke="#5A8F4A" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="12" cy="11" rx="4" ry="2.2" fill="#5A8F4A" stroke="#2C2118" strokeWidth="0.9" transform="rotate(-30 12 11)" />
      <ellipse cx="21" cy="12" rx="3.5" ry="2" fill="#7CB87A" stroke="#2C2118" strokeWidth="0.9" transform="rotate(25 21 12)" />
      <circle cx="13" cy="19" r="1.2" fill="#F5EBDC" opacity="0.5" />
    </svg>
  )
}

export function IconDefault({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M10 6h12v2.5c0 1-.4 2-1.1 2.7L19 13v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V13l-1.9-1.8A4 4 0 0 1 10 8.5V6Z"
        fill="#D9843B"
        stroke="#2C2118"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M12 18h8" stroke="#F5EBDC" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

export function categoryIconFor(id: string) {
  const key = id.toLowerCase()
  if (key === "all") return IconAll
  if (key.includes("jaba")) return IconJaba
  if (key.includes("cider")) return IconCider
  if (key.includes("beer")) return IconBeer
  if (key.includes("tequila") || key.includes("mezcal")) return IconTequila
  if (key.includes("gin")) return IconGin
  if (key.includes("vodka")) return IconVodka
  if (key.includes("whisky") || key.includes("whiskey") || key.includes("bourbon") || key.includes("spirit"))
    return IconWhiskey
  if (key.includes("wine") || key.includes("champagne") || key.includes("prosecco")) return IconWine
  if (key.includes("cocktail") || key.includes("mix")) return IconCocktail
  if (key.includes("energy")) return IconEnergy
  if (key.includes("soft") || key.includes("soda") || key.includes("juice") || key.includes("water"))
    return IconSoft
  return IconDefault
}
