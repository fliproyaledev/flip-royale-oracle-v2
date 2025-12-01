import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Sadece GET isteği
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Redis'teki önbelleği çek
        const cachedPrices = await kv.get('GLOBAL_PRICE_CACHE');

        if (!cachedPrices) {
            // Önbellek boşsa boş dizi dön (Fallback çalışsın)
            return res.status(200).json([]);
        }

        // Redis verisi zaten string/json formatındadır
        return res.status(200).json(cachedPrices);

    } catch (error: any) {
        console.error('[Oracle] Get Prices Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
