import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { PriceOrchestrator } from '../../../lib/price_orchestrator';

// Güvenlik için Environment Variable
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // 1. Güvenlik Kontrolü (URL ?key=... ile çalışır)
    const { key } = req.query;
    if (key !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // 2. Motoru Başlat ve Verileri Çek
        const oracle = new PriceOrchestrator();
        const prices = await oracle.fetchAllPrices();

        // 3. Hata Kontrolü (Boş veri kaydetme)
        if (prices.length === 0) {
            return res.status(500).json({ error: 'No prices fetched, skipping update.' });
        }

        // 4. Redis'e Kaydet (GLOBAL_PRICE_CACHE anahtarına)
        // JSON.stringify ile string olarak kaydediyoruz, maliyeti düşüktür.
        await kv.set('GLOBAL_PRICE_CACHE', JSON.stringify(prices));

        // 5. Log ve Yanıt
        const timestamp = new Date().toISOString();
        console.log(`[Oracle] Updated ${prices.length} tokens at ${timestamp}`);
        
        return res.status(200).json({ 
            success: true, 
            count: prices.length, 
            timestamp 
        });

    } catch (error: any) {
        console.error('[Oracle] Critical Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
