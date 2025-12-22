import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Sadece GET isteği
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Redis'teki önbelleği çek
    const cachedPrices = await kv.get('GLOBAL_PRICE_CACHE');

    if (!cachedPrices) {
        return res.status(200).json({ ok: true, prices: [] });
    }

    // Bazı durumlarda cachedPrices KV içinde string olarak kaydedilmiş olabilir.
    // Hem string hem array durumlarını normalize ederek array döndürüyoruz.
    try {
        if (typeof cachedPrices === 'string') {
            const parsed = JSON.parse(cachedPrices);
            if (Array.isArray(parsed)) return res.status(200).json({ ok: true, prices: parsed });
            // parsed değilse (eski format) fallback
            return res.status(200).json({ ok: true, prices: [] });
        }

        if (Array.isArray(cachedPrices)) {
            return res.status(200).json({ ok: true, prices: cachedPrices });
        }

        // Farklı tip gelirse boş dön
        return res.status(200).json({ ok: true, prices: [] });
    } catch (err) {
        console.error('[Oracle] Failed to parse GLOBAL_PRICE_CACHE:', err);
       return res.status(200).json({ ok: true, prices: [] });
    }        

    } catch (error: any) {
        console.error('[Oracle] Get Prices Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
