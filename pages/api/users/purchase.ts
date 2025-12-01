import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // 1. Sadece POST isteği
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 2. Yetki Kontrolü (Secret Key)
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ORACLE_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized: Invalid Secret' });
    }

    try {
        const { userId, packType, count, paymentMethod, txHash } = req.body;
        
        if (!userId) return res.status(400).json({ error: 'Missing User ID' });

        const cleanId = String(userId).toLowerCase();
        const now = new Date().toISOString();

        // 3. Kullanıcıyı Bul veya OLUŞTUR (Auto-Recovery)
        let user: any = await kv.hget('USERS', cleanId);
        
        if (!user) {
            console.log(`⚠️ [Oracle] Kullanıcı yok, satın almada oluşturuluyor: ${cleanId}`);
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

        // Miktar ve Fiyat Ayarları
        const qty = Number(count) || 1;
        const COST_COMMON = 5000;
        const COST_RARE = 10000;
        // Eğer packType 'rare' değilse varsayılan 'common'
        const validatedPackType = packType === 'rare' ? 'rare' : 'common';
        const costPerPack = validatedPackType === 'rare' ? COST_RARE : COST_COMMON;
        const totalCost = costPerPack * qty;

        // 4. Ödeme Yöntemi Kontrolü
        if (paymentMethod === 'CRYPTO') {
            // A) Kripto Ödeme: Puan düşülmez, sadece loglanır
            console.log(`💎 [Oracle] Crypto purchase confirmed for ${cleanId}. Tx: ${txHash}`);
            user.logs = user.logs || [];
            user.logs.push({ 
                type: 'system', 
                date: now.slice(0, 10), 
                note: `Crypto buy: ${qty} ${validatedPackType} (Tx: ${txHash})` 
            });
        } 
        else {
            // B) Puanla Ödeme: Bakiye kontrolü ve düşümü
            const availablePoints = (user.bankPoints || 0) + (user.giftPoints || 0);
            
            if (availablePoints < totalCost) {
                return res.status(400).json({ 
                    error: `Yetersiz Puan. Gereken: ${totalCost}, Mevcut: ${availablePoints}` 
                });
            }

            // Puan Düşme Mantığı (Önce Gift, Sonra Bank)
            let remainingCost = totalCost;
            
            if ((user.giftPoints || 0) > 0) {
                const useGift = Math.min(user.giftPoints, remainingCost);
                user.giftPoints -= useGift;
                remainingCost -= useGift;
            }
            
            if (remainingCost > 0) {
                user.bankPoints = Math.max(0, (user.bankPoints || 0) - remainingCost);
            }

            // Log Ekle
            user.logs = user.logs || [];
            user.logs.push({ 
                type: 'system', 
                date: now.slice(0, 10), 
                note: `Points buy: ${qty} ${validatedPackType}` 
            });
        }

        // 5. ENVANTERE PAKET EKLEME (Kart Değil, Paket)
        // Paket anahtarı: 'common_pack' veya 'rare_pack'
        const packKey = `${validatedPackType}_pack`;
        
        user.inventory = user.inventory || {};
        user.inventory[packKey] = (user.inventory[packKey] || 0) + qty;

        user.updatedAt = now;

        // 6. Kaydet
        await kv.hset('USERS', { [cleanId]: user });

        console.log(`✅ [Oracle] ${qty} ${validatedPackType} packs added to ${cleanId}`);

        // Frontend'e güncel kullanıcıyı dönüyoruz
        // newCards boş dönüyor çünkü henüz açılmadı
        return res.status(200).json({ ok: true, user, newCards: [] });

    } catch (error: any) {
        console.error('[Oracle] Purchase Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
