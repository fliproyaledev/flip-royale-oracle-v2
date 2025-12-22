// ORACLE REPO: lib/price_orchestrator.ts
// DÜZELTİLDİ: Çapraz kur hesabı kaldırıldı - DexScreener zaten USD fiyat döndürüyor
import { TOKEN_MAP } from './tokens'
import type { Token } from './tokens'
import { getDexPairQuoteStrict } from './dexscreener'
import { getGeckoPoolQuote } from './gecko'
import { kv } from '@vercel/kv'
// Rate limit koruması için sabitler
const DELAY_BETWEEN_REQUESTS_MS = 100;  // Her istek arasında 100ms bekle
const MAX_RETRIES = 3;                   // Başarısız istekleri 3 kez tekrar dene
const RETRY_DELAY_MS = 500;             // Retry'lar arasında 500ms bekle
export type PriceData = {
    tokenId: string
    symbol: string
    pLive: number
    p0: number
    changePct: number
    fdv: number
    ts: string
    source: string
    dexUrl: string
}
function deriveBaseline(currentPrice: number, changePct?: number): number {
    if (changePct === undefined || !isFinite(changePct) || changePct <= -100 || changePct === 0) {
        return currentPrice
    }
    return currentPrice / (1 + changePct / 100)
}
// Bekleme fonksiyonu
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}
export class PriceOrchestrator {
    private results: PriceData[] = []
    private lastKnownPrices: Map<string, PriceData> = new Map()
    // TEK SEFERLİK ÇALIŞTIRMA FONKSİYONU
    async fetchAllPrices() {
        const tokenCount = Object.keys(TOKEN_MAP).length;
        console.log(`[Oracle] Starting fetch for ${tokenCount} tokens...`)
        // Önceki cache'i yükle (fallback için)
        await this.loadLastKnownPrices();
        // Tüm tokenleri SIRALAMA ile çek (rate limit koruması)
        const tokens = Object.values(TOKEN_MAP);
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            // Her istek arasında delay
            if (i > 0) {
                await delay(DELAY_BETWEEN_REQUESTS_MS);
            }
            await this.fetchOneTokenWithRetry(token);
            // Progress log (her 10 token'da bir)
            if ((i + 1) % 10 === 0) {
                console.log(`[Oracle] Progress: ${i + 1}/${tokens.length} tokens fetched`);
            }
        }
        // Eksik tokenları last known prices'tan doldur
        this.fillMissingFromCache();
        console.log(`[Oracle] Fetch complete. Total: ${this.results.length}`)
        return this.results;
    }
    // Önceki cache'i yükle
    private async loadLastKnownPrices() {
        try {
            const cached = await kv.get('GLOBAL_PRICE_CACHE');
            if (cached) {
                const prices = typeof cached === 'string' ? JSON.parse(cached) : cached;
                if (Array.isArray(prices)) {
                    for (const p of prices) {
                        if (p.tokenId) {
                            this.lastKnownPrices.set(p.tokenId, p);
                        }
                    }
                    console.log(`[Oracle] Loaded ${this.lastKnownPrices.size} cached prices for fallback`);
                }
            }
        } catch (e) {
            console.warn('[Oracle] Could not load cached prices:', e);
        }
    }
    // Tek token'ı retry ile çek
    private async fetchOneTokenWithRetry(token: Token) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const data = await this.fetchFromSource(token);
            if (data && data.pLive > 0) {
                // DİKKAT: DexScreener zaten USD fiyatı döndürüyor
                // Çapraz kur hesabı YAPILMIYOR - fiyat direkt kullanılıyor
                this.results.push(data);
                return;
            }
            if (attempt < MAX_RETRIES) {
                await delay(RETRY_DELAY_MS);
            }
        }
        // Tüm retry'lar başarısız - log yaz (cache'ten sonra doldurulacak)
        console.warn(`[Oracle] Failed to fetch ${token.symbol} after ${MAX_RETRIES} attempts`);
    }
    // Eksik tokenları cache'ten doldur
    private fillMissingFromCache() {
        const fetchedIds = new Set(this.results.map(r => r.tokenId));
        let filled = 0;
        for (const [tokenId, cachedPrice] of Array.from(this.lastKnownPrices)) {
            if (!fetchedIds.has(tokenId)) {
                // Bu token fetch edilemedi, cache'ten ekle
                this.results.push({
                    ...cachedPrice,
                    ts: new Date().toISOString(),
                    source: 'cached'
                });
                filled++;
            }
        }
        if (filled > 0) {
            console.log(`[Oracle] Filled ${filled} missing tokens from cache`);
        }
    }
    private async fetchFromSource(token: Token): Promise<PriceData | null> {
        const network = token.dexscreenerNetwork || 'base';

        // Front-end fix logic: Ensure we have a clean pair address
        // The token list might have full URLs or slightly malformed strings
        let pair = token.dexscreenerPair;

        // Extra safety: extract 0x address if it's a URL
        if (pair && pair.includes('/')) {
            const match = pair.match(/0x[a-fA-F0-9]{40}/i);
            if (match) {
                pair = match[0].toLowerCase();
            }
        }

        if (!pair) return null;

        try {
            // 1. Dexscreener Dene
            const dex = await getDexPairQuoteStrict(network, pair);
            if (dex) {
                const p0 = deriveBaseline(dex.priceUsd, dex.changePct);
                return {
                    tokenId: token.id,
                    symbol: token.symbol,
                    pLive: dex.priceUsd,  // Direkt USD fiyatı - çapraz kur YOK
                    p0: p0 > 0 ? p0 : dex.priceUsd,
                    changePct: dex.changePct || 0,
                    fdv: dex.fdv || 0,
                    ts: new Date().toISOString(),
                    source: 'dexscreener',
                    dexUrl: `https://dexscreener.com/${network}/${pair}`
                };
            }
            // 2. Gecko Dene
            const gecko = await getGeckoPoolQuote(network, pair, token.symbol);
            if (gecko) {
                const p0 = deriveBaseline(gecko.priceUsd, gecko.changePct);
                return {
                    tokenId: token.id,
                    symbol: token.symbol,
                    pLive: gecko.priceUsd,  // Direkt USD fiyatı - çapraz kur YOK
                    p0: p0 > 0 ? p0 : gecko.priceUsd,
                    changePct: gecko.changePct || 0,
                    fdv: 0,
                    ts: new Date().toISOString(),
                    source: 'gecko',
                    dexUrl: `https://dexscreener.com/${network}/${pair}`
                };
            }
        } catch (e) {
            // Hata durumunda null dön, retry mekanizması devralacak
            // console.warn(`[Oracle] Error fetching ${token.symbol}:`, e);
        }
        return null;
    }
}
