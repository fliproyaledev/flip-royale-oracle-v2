import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { TOKENS } from '../../../lib/tokens'; // Oracle'daki token listesi

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ORACLE_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { userId, packType, count, useInventory } = req.body;
        const cleanId = userId.toLowerCase();

        // 1. Kullanıcıyı Redis'ten Çek
        const user: any = await kv.hget('USERS', cleanId);
        if (!user) return res.status(404).json({ error: 'User not found in Oracle' });

        // 2. Fiyatlandırma
        const COST_COMMON = 5000;
        const COST_RARE = 10000;
        const costPerPack = packType === 'rare' ? COST_RARE : COST_COMMON;
        const totalCost = costPerPack * count;

        // 3. Puan Kontrolü (Hediye değilse)
        if (!useInventory) {
            const availablePoints = (user.bankPoints || 0) + (user.giftPoints || 0);
            if (availablePoints < totalCost) {
                return res.status(400).json({ error: 'Insufficient points' });
            }

            // Puan Düşme Mantığı (Önce Gift, Sonra Bank)
            let remainingCost = totalCost;
            
            if (user.giftPoints > 0) {
                const useGift = Math.min(user.giftPoints, remainingCost);
                user.giftPoints -= useGift;
                remainingCost -= useGift;
            }
            
            if (remainingCost > 0) {
                user.bankPoints = Math.max(0, user.bankPoints - remainingCost);
            }
            
            // Log ekle
            user.logs = user.logs || [];
            user.logs.push({
                type: 'system',
                date: new Date().toISOString().split('T')[0],
                note: `Bought ${count} ${packType} packs`
            });
        }

        // 4. Kart Üretimi (RNG)
        const newCards: string[] = [];
        const totalCards = count * 5; // Her pakette 5 kart

        for (let i = 0; i < totalCards; i++) {
            // Basit RNG: Rare pakette şans daha yüksek olsun
            // (Burayı daha sonra geliştirebilirsin)
            const randomToken = TOKENS[Math.floor(Math.random() * TOKENS.length)];
            newCards.push(randomToken.id);
            
            // Envantere ekle
            user.inventory = user.inventory || {};
            user.inventory[randomToken.id] = (user.inventory[randomToken.id] || 0) + 1;
        }

        user.updatedAt = new Date().toISOString();

        // 5. Kaydet ve Döndür
        await kv.hset('USERS', { [cleanId]: user });

        return res.status(200).json({ ok: true, user, newCards });

    } catch (error: any) {
        console.error('[Oracle] Purchase Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
