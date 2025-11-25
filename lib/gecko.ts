// lib/gecko.ts

export type GeckoQuote = {
  network: string
  pool: string
  priceUsd: number
  changePct?: number
  fetchedAt: number
  raw: any
}

const EXTERNAL_HEADERS: Record<string, string> = {
  accept: 'application/json',
  'user-agent': 'FlipFlopPriceBot/1.0 (+https://flipflop.local)'
}

// Price selection helper
function pickPriceBySymbol(attrs: any, symbol?: string | null): number | null {
  const baseUsd = Number(attrs?.base_token_price_usd ?? NaN)
  const quoteUsd = Number(attrs?.quote_token_price_usd ?? NaN)

  if (symbol) {
    const s = String(symbol).toUpperCase()
    const baseSym = String(attrs?.base_token?.symbol || '').toUpperCase()
    const quoteSym = String(attrs?.quote_token?.symbol || '').toUpperCase()

    if (s === baseSym && isFinite(baseUsd)) return baseUsd
    if (s === quoteSym && isFinite(quoteUsd)) return quoteUsd
  }

  if (isFinite(baseUsd)) return baseUsd
  if (isFinite(quoteUsd)) return quoteUsd

  return null
}

export async function getGeckoPoolQuote(
  network: string,
  poolAddress: string,
  tokenSymbol?: string | null
): Promise<GeckoQuote | null> {
  if (!network || !poolAddress) return null

  const net = network.toLowerCase()
  const addr = poolAddress.toLowerCase()
  const url = `https://api.geckoterminal.com/api/v2/networks/${net}/pools/${addr}`

  try {
    const r = await fetch(url, { headers: EXTERNAL_HEADERS })
    if (!r.ok) return null

    const j: any = await r.json()
    const attrs = j?.data?.attributes
    if (!attrs) return null

    const picked = pickPriceBySymbol(attrs, tokenSymbol)
    if (!isFinite(picked ?? NaN)) return null

    const change = Number(
      attrs?.price_change_percentage?.h24 ??
      attrs?.price_change?.h24 ??
      NaN
    )

    return {
      network: net,
      pool: addr,
      priceUsd: picked,
      changePct: isFinite(change) ? change : undefined,
      fetchedAt: Date.now(),
      raw: j
    }
  } catch {
    return null
  }
}
