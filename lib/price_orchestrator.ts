import { TOKEN_MAP } from './tokens'
import type { Token } from './tokens'
import { getDexPairQuoteStrict } from './dexscreener'
import { getGeckoPoolQuote } from './gecko'

const RAW_VIRTUAL_ID = process.env.VIRTUAL_TOKEN_ID || 'virtual';
const VIRTUAL_TOKEN_ID = RAW_VIRTUAL_ID.toLowerCase().trim();

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
  if (!isFinite(changePct) || changePct === undefined || changePct <= -100 || changePct === 0) {
    return currentPrice
  }
  return currentPrice / (1 + changePct / 100)
}

export class PriceOrchestrator {
  private virtualPriceUsd: number = 0
  private results: PriceData[] = []

  // TEK SEFERLİK ÇALIŞTIRMA FONKSİYONU
  async fetchAllPrices() {
    console.log(`[Oracle] Starting fetch for ${Object.keys(TOKEN_MAP).length} tokens...`)

    // 1. Önce Virtual Token'i bul ve çek
    await this.fetchVirtualToken();

    // 2. Diğer tüm tokenleri paralel olarak çek
    const promises = Object.values(TOKEN_MAP).map(token => {
        // Virtual'i tekrar çekme
        if (token.id === VIRTUAL_TOKEN_ID || token.symbol === 'VIRTUAL') return null;
        return this.fetchOneToken(token);
    }).filter(Boolean) as Promise<void>[];

    await Promise.all(promises);

    console.log(`[Oracle] Fetch complete. Virtual Price: $${this.virtualPriceUsd}. Total: ${this.results.length}`)
    return this.results;
  }

  private async fetchVirtualToken() {
    // Token Map'ten Virtual'i bul
    const vToken = Object.values(TOKEN_MAP).find(t => t.id === VIRTUAL_TOKEN_ID || t.symbol === 'VIRTUAL');
    if (vToken) {
        const data = await this.fetchFromSource(vToken);
        if (data) {
            this.virtualPriceUsd = data.pLive;
            // Virtual'i listeye ekle
            this.results.push(data); 
        }
    }
  }

  private async fetchOneToken(token: Token) {
    const rawData = await this.fetchFromSource(token);
    
    if (rawData) {
        // ÇAPRAZ KUR HESABI (Cross-Rate)
        // Eğer Virtual fiyatı varsa ve bu token Virtual değilse çarp
        let finalPrice = rawData.pLive;
        let finalP0 = rawData.p0;
        let finalFdv = rawData.fdv;

        if (this.virtualPriceUsd > 0) {
            finalPrice *= this.virtualPriceUsd;
            finalP0 *= this.virtualPriceUsd;
            finalFdv *= this.virtualPriceUsd;
        }

        this.results.push({
            ...rawData,
            pLive: finalPrice,
            p0: finalP0,
            fdv: finalFdv
        });
    }
  }

  private async fetchFromSource(token: Token): Promise<PriceData | null> {
    const network = token.dexscreenerNetwork || 'base';
    const pair = token.dexscreenerPair;
    if (!pair) return null;

    try {
        // 1. Dexscreener Dene
        const dex = await getDexPairQuoteStrict(network, pair);
        if (dex) {
            const p0 = deriveBaseline(dex.priceUsd, dex.changePct);
            return {
                tokenId: token.id,
                symbol: token.symbol,
                pLive: dex.priceUsd,
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
                pLive: gecko.priceUsd,
                p0: p0 > 0 ? p0 : gecko.priceUsd,
                changePct: gecko.changePct || 0,
                fdv: 0,
                ts: new Date().toISOString(),
                source: 'gecko',
                dexUrl: `https://dexscreener.com/${network}/${pair}`
            };
        }
    } catch (e) {
        console.error(`Error fetching ${token.symbol}:`, e);
    }
    return null;
  }
}
