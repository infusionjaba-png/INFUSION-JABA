import { MenuItem } from "@/types/menu"

const STYLE_WORDS = [
  "blanco",
  "reposado",
  "añejo",
  "anejo",
  "cristalino",
  "extra añejo",
  "ipa",
  "lager",
  "stout",
  "pilsner",
  "wheat",
  "dry",
  "sweet",
  "spiced",
  "gold",
  "silver",
  "dark",
  "light",
  "single malt",
  "blend",
]

const PAIRINGS: Record<string, string> = {
  tequila: "Pairs with lime & rock salt",
  whiskey: "Pairs with dark chocolate",
  whisky: "Pairs with dark chocolate",
  vodka: "Pairs with citrus & soda",
  gin: "Pairs with tonic & cucumber",
  rum: "Pairs with cola & lime",
  beer: "Pairs with salted nuts",
  wine: "Pairs with cheese & olives",
  champagne: "Pairs with oysters",
  juice: "Pairs with fresh fruit",
  cocktail: "Pairs with bar snacks",
  soft: "Pairs with light bites",
  "soft-drinks": "Pairs with light bites",
  soft_drinks: "Pairs with light bites",
}

const NOTES: Record<string, string> = {
  tequila:
    "Crisp, unaged 100% agave. Bright citrus on the nose, clean pepper finish. Best ice-cold.",
  whiskey:
    "Warm oak and caramel notes. Best served neat or with a single large cube.",
  whisky:
    "Warm oak and caramel notes. Best served neat or with a single large cube.",
  vodka: "Crisp and clean. Best served ice-cold, neat or in a classic mix.",
  gin: "Botanical and bright. Best with tonic, ice, and a citrus twist.",
  rum: "Rich molasses and spice. Best over ice or lengthened with cola.",
  beer: "Crisp and refreshing. Best served ice-cold straight from the bar.",
  wine: "Balanced fruit and structure. Best at the right chill for the style.",
  juice: "Fresh and bright. Best served cold over ice.",
  cocktail: "House-balanced and ready to pour. Best enjoyed fresh.",
  soft: "Cold and refreshing. Best over ice.",
}

function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function categoryLabelFromId(category: string): string {
  if (!category) return "Drink"
  return titleCase(category)
}

export function extractStyle(name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const w of STYLE_WORDS) {
    if (lower.includes(w)) return titleCase(w)
  }
  return undefined
}

export function formatVolumeLabel(size?: string, unit?: string, name?: string): string {
  const raw = `${size || ""} ${unit || ""}`.trim()
  const lowerName = (name || "").toLowerCase()
  const isShot =
    lowerName.includes("shot") ||
    /\b(25|30|35|40|45|50)\s*ml\b/i.test(raw) ||
    /\b(25|30|35|40|45|50)\b/.test(size || "")
  const isBottle =
    lowerName.includes("bottle") ||
    /\b(700|750|1000|1)\s*(ml|l)\b/i.test(raw) ||
    /\b(700|750|1000)\b/.test(size || "")

  let vol = raw
  if (size && !/ml|l\b/i.test(size) && (!unit || unit === "item")) {
    const n = parseFloat(size)
    if (!Number.isNaN(n)) {
      vol = n >= 1 && n <= 5 && !Number.isInteger(n) ? `${size}L` : `${size}ml`
    }
  } else if (size && unit && unit !== "item") {
    vol = `${size}${/ml|l/i.test(unit) ? unit : ` ${unit}`}`
  } else if (size) {
    vol = size
  }

  vol = vol.replace(/\s+/g, " ").trim()
  if (!vol) {
    if (isShot) return "Shot"
    if (isBottle) return "Bottle"
    return ""
  }

  if (isShot && !/shot/i.test(vol)) return `${vol} shot`
  if (isBottle && !/bottle/i.test(vol)) return `${vol} bottle`
  return vol
}

export function servingLabel(item: MenuItem): string {
  const lower = item.name.toLowerCase()
  const vol = item.volumeLabel || formatVolumeLabel(item.size, item.unit, item.name)
  const mlMatch = vol.match(/(\d+\s*ml|\d+(?:\.\d+)?\s*l)/i)
  const measure = mlMatch ? mlMatch[1].replace(/\s+/g, "") : ""

  if (lower.includes("shot") || /\b(25|30|35|40|45|50)\s*ml\b/i.test(vol)) {
    return measure ? `Shot · ${measure}` : "Shot"
  }
  if (lower.includes("bottle") || /\b(700|750|1000)\s*ml\b/i.test(vol) || /\b1\s*l\b/i.test(vol)) {
    return measure ? `Bottle · ${measure}` : "Bottle"
  }
  return vol || item.name
}

export function productBaseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(shot|bottle|can|pint|glass|single|double)\b/g, "")
    .replace(/\b\d+\s*(ml|l|cl)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function tastingNotesFor(item: MenuItem): string {
  if (item.tastingNotes) return item.tastingNotes
  const key = item.category.replace(/-/g, "").toLowerCase()
  const fromCat =
    NOTES[item.category] ||
    NOTES[key] ||
    NOTES[item.category.split("-")[0]] ||
    `A house pour from the bar. Best served cold — ask your server for the house recommendation.`
  return fromCat
}

export function pairingFor(item: MenuItem): string {
  if (item.pairing) return item.pairing
  return (
    PAIRINGS[item.category] ||
    PAIRINGS[item.category.split("-")[0]] ||
    "Ask the bar for a house pairing"
  )
}

export function eyebrowFor(item: MenuItem): string {
  const parts: string[] = []
  const cat = (item.categoryLabel || categoryLabelFromId(item.category)).toUpperCase()
  if (cat) parts.push(cat)
  if (item.style) parts.push(item.style.toUpperCase())
  if (item.abv) parts.push(item.abv.toUpperCase())
  return parts.join(" · ")
}

export function findServingSiblings(
  item: MenuItem,
  catalog: MenuItem[]
): MenuItem[] {
  const key = productBaseKey(item.name)
  if (!key) return [item]

  const siblings = catalog.filter((p) => {
    if (p.category !== item.category) return false
    return productBaseKey(p.name) === key
  })

  if (siblings.length <= 1) return [item]

  // Prefer distinct sizes / shot-bottle pairs
  const ranked = [...siblings].sort((a, b) => {
    const aShot = /shot/i.test(a.name) || /25|30|50/.test(a.size || "")
    const bShot = /shot/i.test(b.name) || /25|30|50/.test(b.size || "")
    if (aShot !== bShot) return aShot ? -1 : 1
    return a.price - b.price
  })

  return ranked
}

export function enrichMenuItem(p: {
  id: string
  name: string
  price: number
  image?: string
  category?: string
  stock?: number
  size?: string
  unit?: string
  isJaba?: boolean
  brand?: string
}): MenuItem {
  const category = p.category?.toLowerCase().replace(/\s+/g, "-") || "other"
  const volumeLabel = formatVolumeLabel(p.size, p.unit, p.name)
  const style = extractStyle(p.name)
  const item: MenuItem = {
    id: p.id,
    name: p.name,
    description: volumeLabel || p.unit || "",
    price: Number(p.price) || 0,
    image: p.image && p.image !== "/placeholder.svg" ? p.image : "/placeholder.jpg",
    category,
    inStock: (p.stock || 0) > 0,
    isPopular: false,
    isJaba: p.isJaba === true,
    brand: p.brand,
    size: p.size || "",
    unit: p.unit || "",
    volumeLabel,
    categoryLabel: categoryLabelFromId(category),
    style,
  }
  item.tastingNotes = tastingNotesFor(item)
  item.pairing = pairingFor(item)
  // Common spirit ABV hint when category suggests it and name doesn't contradict
  if (!item.abv && /tequila|whiskey|whisky|vodka|gin|rum|spirit/.test(category)) {
    item.abv = "40% ABV"
  }
  return item
}
