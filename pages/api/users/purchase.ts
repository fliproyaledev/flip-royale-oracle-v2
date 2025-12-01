import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { TOKENS } from '../../../lib/tokens'; 

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ORACLE_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // paymentMethod parametresini ekledik
        const { userId, packType, count, useInventory, paymentMethod, txHash } = req.body;
        
        if (!userId) return res.status(400).json({ error: 'Missing User ID' });

        const cleanId = String(userId).toLowerCase();
        const now = new Date().toISOString();

        // 1. Kullanıcıyı Bul veya Oluştur
        let user: any = await kv.hget('USERS', cleanId);
        if (!user) {
            console.log(`⚠️ [Oracle] Kullanıcı yok, satın alma sırasında oluşturuluyor: ${cleanId}`);
            user = {
                id: cleanId,
                username: 'Guardian',
                name: 'Guardian',
                totalPoints: 0,
                bankPoints: 0,
                giftPoints: 0,
                inventory: { common: 0 },
                createdAt: now,
                updatedAt: now,
                logs: []
            };
        }

        const qty = Number(count) || 1;

        // 2. Ödeme Kontrolü (KRİTİK GÜNCELLEME)
        // Eğer ödeme 'CRYPTO' ise puan kontrolünü ATLA.
        if (paymentMethod === 'CRYPTO') {
            console.log(`💎 [Oracle] Crypto purchase verified for ${cleanId}. Tx: ${txHash}`);
            user.logs.push({ 
                type: 'system', 
                date: now.slice(0, 10), 
                note: `Crypto buy: ${qty} ${packType} (Tx: ${txHash})` 
            });
        } 
        else if (useInventory) {
            // Envanterden Kullanım
            const currentPacks = (user.inventory && user.inventory[packType]) || 0;
            if (currentPacks < qty) {
                return res.status(400).json({ error: 'Insufficient packs' });
            }
            user.inventory[packType] -= qty;
            if (user.inventory[packType] <= 0) delete user.inventory[packType];
        } 
        else {
            // Puanla Alım (Mevcut Mantık)
            const COST_COMMON = 5000;
            const COST_RARE = 10000;
            const costPerPack = packType === 'rare' ? COST_RARE : COST_COMMON;
            const totalCost = costPerPack * qty;
            
            const availablePoints = (user.bankPoints || 0) + (user.giftPoints || 0);
            if (availablePoints < totalCost) {
                return res.status(400).json({ error: 'Insufficient points' });
            }
            
            // Puan Düşümü
            let remainingCost = totalCost;
            if ((user.giftPoints || 0) > 0) {
                const useGift = Math.min(user.giftPoints, remainingCost);
                user.giftPoints -= useGift;
                remainingCost -= useGift;
            }
            if (remainingCost > 0) {
                user.bankPoints = Math.max(0, (user.bankPoints || 0) - remainingCost);
            }
        }

        // 3. Kart Dağıtımı
        const newCards: string[] = [];
        const totalCardsToGive = qty * 5;

        if (TOKENS && TOKENS.length > 0) {
            for (let i = 0; i < totalCardsToGive; i++) {
                const randomToken = TOKENS[Math.floor(Math.random() * TOKENS.length)];
                newCards.push(randomToken.id);
                user.inventory = user.inventory || {};
                user.inventory[randomToken.id] = (user.inventory[randomToken.id] || 0) + 1;
            }
        }

        user.updatedAt = now;
        await kv.hset('USERS', { [cleanId]: user });

        return res.status(200).json({ ok: true, user, newCards });

    } catch (error: any) {
        console.error('[Oracle] Purchase Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
