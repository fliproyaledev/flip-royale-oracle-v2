import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { TOKENS } from '../../../lib/tokens'; 

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (req.headers.authorization !== `Bearer ${ORACLE_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { userId, packType } = req.body;
        const cleanId = String(userId).toLowerCase();
        const packKey = `${packType}_pack`; // common_pack

        const user: any = await kv.hget('USERS', cleanId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // 1. Paketi var mı?
        const currentPacks = (user.inventory && user.inventory[packKey]) || 0;
        if (currentPacks < 1) {
            return res.status(400).json({ error: `No ${packType} packs to open` });
        }

        // 2. Paketi düş
        user.inventory[packKey] -= 1;
        if (user.inventory[packKey] <= 0) delete user.inventory[packKey];

        // 3. Kartları Üret (RNG)
        const newCards: string[] = [];
        const totalCards = 5;

        // BURAYA ŞANS ORANLARINI EKLEYEBİLİRSİN (Rare/Common ayrımı)
        // Şimdilik basit rastgele seçim:
        for (let i = 0; i < totalCards; i++) {
            const randomToken = TOKENS[Math.floor(Math.random() * TOKENS.length)];
            newCards.push(randomToken.id);
            user.inventory[randomToken.id] = (user.inventory[randomToken.id] || 0) + 1;
        }

        await kv.hset('USERS', { [cleanId]: user });

        return res.status(200).json({ ok: true, user, newCards });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}
