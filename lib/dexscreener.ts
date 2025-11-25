import type { Token } from './tokens'
import { buildDexscreenerViewUrl } from './tokens'

export type DexscreenerPairRef = {
  network: string
  pair: string
}

export type DexscreenerQuote = {
  network: string
  pair: string
  priceUsd: number
  changePct?: number
  liquidityUsd?: number
  fdv?: number
  fetchedAt: number
  raw: any
}

const CACHE_TTL_MS = 45_000
const NULL_CACHE_TTL_MS = 60_000
const CHUNK_SIZE = 30
const FLUSH_DELAY_MS = 25
const MAX_RETRY = 3

const SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const SEARCH_MIN_INTERVAL_MS = 400

const EXTERNAL_HEADERS: Record<string, string> = {
  accept: 'application/json',
  'user-agent': 'FlipFlopPriceBot/1.0 (+https://flipflop.local)'
}

type CacheEntry = {
  expiresAt: number
  value: DexscreenerQuote | null
}

type NetworkQueue = {
  pairs: Set<string>
  resolvers: Map<string, Array<{ resolve: Function; reject: Function }>>
  timer?: NodeJS.Timeout
}

type SearchCacheEntry = {
  expiresAt: number
  value: DexscreenerPairRef | null
}

const globalAny = globalThis as any

const pairCache: Map<string, CacheEntry> =
  globalAny.__flipDexCache ?? (globalAny.__flipDexCache = new Map())

const networkQueues: Map<string, NetworkQueue> =
  globalAny.__flipDexQueues ?? (globalAny.__flipDexQueues = new Map())

const searchCache: Map<string, SearchCacheEntry> =
  globalAny.__flipDexSearch ?? (globalAny.__flipDexSearch = new Map())

let searchChain: Promise<unknown> = Promise.resolve()
let lastSearchAt = 0

// -----------------------------------------------------
// Utils
// -----------------------------------------------------

function toKey(network: string, pair: string): string {
  return `${network.toLowerCase()}:${pair.toLowerCase()}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isHexAddressLower(s: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(s)
}

// -----------------------------------------------------
// Public API
// -----------------------------------------------------

export async function getDexPairQuote(network: string, pair: string) {
  if (!network || !pair) return null

  const key = toKey(network, pair)
  const now = Date.now()
  const cached = pairCache.get(key)

  if (cached && cached.expiresAt > now) return cached.value

  return enqueue(network, pair)
}

export async function getDexPairQuoteStrict(network: string, pair: string) {
  if (!network || !pair) return null

  const net = network.toLowerCase()
  const pr = pair.toLowerCase()
  const key = toKey(net, pr)
  const now = Date.now()
  const cached = pairCache.get(key)

  if (cached && cached.expiresAt > now) return cached.value

  const quote = await fetchSinglePair(net, pr)

  pairCache.set(key, {
    value: quote,
    expiresAt: now + (quote ? CACHE_TTL_MS : NULL_CACHE_TTL_MS)
  })

  return quote
}

// Main function: find best pair for token
export async function findDexPairForToken(
  token: Token
): Promise<DexscreenerPairRef | null> {
  if (!token?.symbol && !token?.name) return null

  const preferNetwork = (token.dexscreenerNetwork || 'base').toLowerCase()

  const key = `${token.id || token.symbol}::${preferNetwork}`
  const now = Date.now()
  const cached = searchCache.get(key)

  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const queries = Array.from(new Set([token.symbol, token.name].filter(Boolean)))

  let result: DexscreenerPairRef | null = null

  const job = async () => {
    for (const q of queries) {
      const found = await runSearch(q, token, preferNetwork)
      if (found) {
        result = normalizeRef(found)
        break
      }
    }
    searchCache.set(key, {
      value: result,
      expiresAt: now + SEARCH_CACHE_TTL_MS
    })
    return result
  }

  const chained = searchChain.then(job, job)
  searchChain = chained.then(() => undefined).catch(() => undefined)
  return chained
}

function normalizeRef(ref: DexscreenerPairRef | null | undefined) {
  if (!ref?.network || !ref?.pair) return null
  return {
    network: ref.network.toLowerCase(),
    pair: ref.pair.toLowerCase()
  }
}

// -----------------------------------------------------
// Search System
// -----------------------------------------------------

async function runSearch(
  query: string,
  token: Token,
  requiredNetwork: string
): Promise<DexscreenerPairRef | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const wait = Math.max(
    0,
    SEARCH_MIN_INTERVAL_MS - (Date.now() - lastSearchAt)
  )
  if (wait > 0) await delay(wait)
  lastSearchAt = Date.now()

  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(
    trimmed
  )}`

  try {
    const res = await fetch(url, { headers: EXTERNAL_HEADERS })
    if (!res.ok) return null

    const json = await res.json()
    const pairs = Array.isArray(json?.pairs) ? json.pairs : []
    if (!pairs.length) return null

    const matches = pairs.filter(
      (p) => String(p?.chainId).toLowerCase() === requiredNetwork
    )

    if (!matches.length) return null

    const scored = scoreAndSort(matches, token.symbol)

    const pick = scored[0]?.record ?? matches[0]

    const network = String(pick.chainId || '').trim().toLowerCase()
    const pair = String(pick.pairAddress || '').trim().toLowerCase()

    if (!network || !pair) return null

    return { network, pair }
  } catch {
    return null
  }
}

function scoreAndSort(records: any[], target: string) {
  return records
    .map((p) => ({
      record: p,
      score: scoreRecord(p, target)
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
}

function scoreRecord(r: any, target: string) {
  let score = 0

  const symbol = String(r?.baseToken?.symbol || '').toUpperCase()
  const liquidity = Number(r?.liquidity?.usd || 0)

  if (liquidity > 0) score += Math.log10(liquidity + 10)

  if (symbol === target) score += 50
  else if (symbol.includes(target)) score += 5

  const age = Number(r?.pairCreatedAt || 0)
  score += age / 1e9

  return score
}

// -----------------------------------------------------
// Queue + Chunk System (rate-limit protection)
// -----------------------------------------------------

function enqueue(network: string, pair: string): Promise<DexscreenerQuote | null> {
  const q = getQueue(network)
  const pr = pair.toLowerCase()

  return new Promise((resolve, reject) => {
    const list = q.resolvers.get(pr) || []
    list.push({ resolve, reject })
    q.resolvers.set(pr, list)
    q.pairs.add(pr)

    if (!q.timer) {
      q.timer = setTimeout(() => flushQueue(network), FLUSH_DELAY_MS)
    }
  })
}

function getQueue(network: string): NetworkQueue {
  const net = network.toLowerCase()
  let q = networkQueues.get(net)

  if (!q) {
    q = { pairs: new Set(), resolvers: new Map() }
    networkQueues.set(net, q)
  }

  return q
}

async function flushQueue(network: string) {
  const net = network.toLowerCase()
  const q = networkQueues.get(net)
  if (!q) return

  q.timer = undefined

  const pairs = Array.from(q.pairs)
  q.pairs.clear()

  const resolvers = q.resolvers
  q.resolvers = new Map()

  for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
    const chunk = pairs.slice(i, i + CHUNK_SIZE)
    await fetchChunk(net, chunk, resolvers)
  }
}

// -----------------------------------------------------
// Fetch Chunk
// -----------------------------------------------------

async function fetchChunk(
  network: string,
  chunk: string[],
  resolvers: Map<string, Array<{ resolve: Function; reject: Function }>>
) {
  const url = `https://api.dexscreener.com/latest/dex/pairs/${network}/${chunk.join(
    ','
  )}`

  let lastError = null

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      const r = await fetch(url, { headers: EXTERNAL_HEADERS })

      if (r.status === 429) {
        await delay(250 * Math.pow(2, attempt))
        continue
      }

      if (!r.ok) {
        lastError = new Error(`Dexscreener responded ${r.status}`)
        break
      }

      const j = await r.json()
      const pairs = Array.isArray(j?.pairs) ? j.pairs : []

      const map = new Map<string, DexscreenerQuote>()

      for (const item of pairs) {
        const address = String(item?.pairAddress || '').toLowerCase()
        const price = Number(item?.priceUsd)

        if (!address || !isFinite(price) || price <= 0) continue

        const change = Number(
          item?.priceChange?.h24 ??
            item?.priceChange?.h6 ??
            item?.priceChange?.h1 ??
            item?.priceChange?.m5
        )

        const liquidity = Number(item?.liquidity?.usd ?? 0)

        const fdvRaw = item?.fdv
        const fdv =
          typeof fdvRaw === 'number'
            ? fdvRaw
            : Number(fdvRaw?.usd ?? 0)

        map.set(address, {
          network,
          pair: address,
          priceUsd: price,
          changePct: isFinite(change) ? change : undefined,
          liquidityUsd: isFinite(liquidity) ? liquidity : undefined,
          fdv: isFinite(fdv) && fdv > 0 ? fdv : undefined,
          fetchedAt: Date.now(),
          raw: item
        })
      }

      const unresolved: string[] = []

      for (const p of chunk) {
        const key = p.toLowerCase()
        const entry = map.get(key) ?? null

        if (entry) resolvePair(network, key, entry, resolvers)
        else unresolved.push(key)
      }

      for (const tokenAddr of unresolved) {
        if (!isHexAddressLower(tokenAddr)) {
          resolvePair(network, tokenAddr, null, resolvers)
          continue
        }

        const best = await resolveTokenToBestPair(network, tokenAddr)

        if (!best) {
          resolvePair(network, tokenAddr, null, resolvers)
          continue
        }

        const q = await fetchSinglePair(network, best)

        if (q) {
          const realKey = toKey(network, best)
          pairCache.set(realKey, {
            value: q,
            expiresAt: Date.now() + CACHE_TTL_MS
          })
          resolvePair(network, tokenAddr, q, resolvers)
        } else {
          resolvePair(network, tokenAddr, null, resolvers)
        }
      }

      return
    } catch (err) {
      lastError = err
      await delay(200)
    }
  }

  for (const pr of chunk) {
    rejectPair(pr.toLowerCase(), lastError, resolvers)
  }
}

// -----------------------------------------------------
// Fetch Single Pair
// -----------------------------------------------------

async function fetchSinglePair(
  network: string,
  pair: string
): Promise<DexscreenerQuote | null> {
  const url = `https://api.dexscreener.com/latest/dex/pairs/${network}/${pair}`

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      const r = await fetch(url, { headers: EXTERNAL_HEADERS })

      if (r.status === 429) {
        await delay(250 * Math.pow(2, attempt))
        continue
      }

      if (!r.ok) return null

      const j = await r.json()
      const item = j?.pair || (Array.isArray(j?.pairs) ? j.pairs[0] : null)

      if (!item) return null

      const addr = String(item?.pairAddress || '').toLowerCase()
      const price = Number(item?.priceUsd)

      if (!addr || !isFinite(price) || price <= 0) return null

      const change = Number(
        item?.priceChange?.h24 ??
          item?.priceChange?.h6 ??
          item?.priceChange?.h1 ??
          item?.priceChange?.m5
      )

      const liquidity = Number(item?.liquidity?.usd ?? 0)

      const fdvRaw = item?.fdv
      const fdv =
        typeof fdvRaw === 'number'
          ? fdvRaw
          : Number(fdvRaw?.usd ?? 0)

      return {
        network,
        pair: addr,
        priceUsd: price,
        changePct: isFinite(change) ? change : undefined,
        liquidityUsd: isFinite(liquidity) ? liquidity : undefined,
        fdv: isFinite(fdv) && fdv > 0 ? fdv : undefined,
        fetchedAt: Date.now(),
        raw: item
      }
    } catch {
      await delay(200)
    }
  }

  return null
}

// -----------------------------------------------------
// Resolve Token → Best LP
// -----------------------------------------------------

async function resolveTokenToBestPair(
  network: string,
  tokenAddress: string
): Promise<string | null> {
  try {
    const tokenUrl = `https://api.dexscreener.com/latest/dex/tokens/${network}/${tokenAddress}`
    const rt = await fetch(tokenUrl, { headers: EXTERNAL_HEADERS })

    if (rt.ok) {
      const jt = await rt.json()
      const pairs = Array.isArray(jt?.pairs) ? jt.pairs : []
      const pick = pickBestPair(pairs, network, tokenAddress)
      if (pick) return pick
    }
  } catch {}

  try {
    const globalUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
    const rg = await fetch(globalUrl, { headers: EXTERNAL_HEADERS })

    if (rg.ok) {
      const jg = await rg.json()
      const pairs = Array.isArray(jg?.pairs) ? jg.pairs : []
      const pick = pickBestPair(pairs, network, tokenAddress)
      if (pick) return pick
    }
  } catch {}

  try {
    const rs = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(
        tokenAddress
      )}`,
      { headers: EXTERNAL_HEADERS }
    )
    if (rs.ok) {
      const js = await rs.json()
      const pairs = Array.isArray(js?.pairs) ? js.pairs : []
      const filtered = pairs.filter(
        (p) => String(p?.chainId).toLowerCase() === network
      )
      const pick = pickBestPair(filtered, network, tokenAddress)
      if (pick) return pick
    }
  } catch {}

  return null
}

function pickBestPair(pairs: any[], network: string, token?: string) {
  if (!pairs?.length) return null

  const norm = token?.toLowerCase()

  const valid = pairs
    .filter((p) => {
      const chain = String(p?.chainId).toLowerCase()
      if (chain !== network) return false

      const addr = String(p?.pairAddress || '').toLowerCase()
      if (!isHexAddressLower(addr)) return false

      const liq = p?.liquidity?.usd
      return liq != null
    })
    .map((p) => ({
      addr: String(p.pairAddress).toLowerCase(),
      liquidity: Number(p?.liquidity?.usd || 0),
      base: String(p?.baseToken?.address || '').toLowerCase(),
      quote: String(p?.quoteToken?.address || '').toLowerCase()
    }))

  if (!valid.length) return null

  valid.sort((a, b) => {
    const aMatch = norm && (a.base === norm || a.quote === norm) ? 1 : 0
    const bMatch = norm && (b.base === norm || b.quote === norm) ? 1 : 0

    if (aMatch !== bMatch) return bMatch - aMatch

    return b.liquidity - a.liquidity
  })

  return valid[0].addr
}

// -----------------------------------------------------
// Resolver Helpers
// -----------------------------------------------------

function resolvePair(
  network: string,
  pair: string,
  quote: DexscreenerQuote | null,
  resolvers: Map<string, Array<{ resolve: Function; reject: Function }>>
) {
  const key = toKey(network, pair)
  const list = resolvers.get(pair) || []
  const expires = Date.now() + (quote ? CACHE_TTL_MS : NULL_CACHE_TTL_MS)

  pairCache.set(key, { value: quote, expiresAt: expires })

  for (const { resolve } of list) resolve(quote)
}

function rejectPair(
  pair: string,
  err: any,
  resolvers: Map<string, Array<{ resolve: Function; reject: Function }>>
) {
  const list = resolvers.get(pair) || []
  for (const { reject } of list) reject(err)
}

// -----------------------------------------------------
// Build Pair View URL
// -----------------------------------------------------

export function buildPairViewUrl(
  ref: DexscreenerPairRef | null | undefined
): string | undefined {
  if (!ref) return undefined
  return buildDexscreenerViewUrl(undefined, ref.network, ref.pair)
}
