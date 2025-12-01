import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { TOKENS } from '../../../lib/tokens'; 

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Yetki Kontrolü
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ORACLE_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized: Invalid Secret' });
    }

    try {
        const { userId, packType, count, useInventory } = req.body;
        
        if (!userId) return res.status(400).json({ error: 'Missing User ID' });

        const cleanId = String(userId).toLowerCase();
        const now = new Date().toISOString();

        // 2. Kullanıcıyı Çekmeye Çalış
        let user: any = await kv.hget('USERS', cleanId);

        // 🛠️ AUTO-FIX: Kullanıcı Yoksa O Anda Oluştur
        if (!user) {
            console.log(`⚠️ [Oracle] Kullanıcı bulunamadı, otomatik oluşturuluyor: ${cleanId}`);
            user = {
                id: cleanId,
                username: 'Guardian', // Geçici isim
                name: 'Guardian',
                totalPoints: 0,
                bankPoints: 0,
                giftPoints: 0,
                inventory: { common: 0 }, // Başlangıçta boş
                createdAt: now,
                updatedAt: now,
                logs: [{ type: 'system', date: now.slice(0, 10), note: 'auto-created-during-purchase' }]
            };
            // Yeni kullanıcıyı hemen kaydet
            await kv.hset('USERS', { [cleanId]: user });
        }

        // 3. Fiyatlandırma ve Mantık
        const qty = Number(count) || 1;
        const COST_COMMON = 5000;
        const COST_RARE = 10000;
        const costPerPack = packType === 'rare' ? COST_RARE : COST_COMMON;
        const totalCost = costPerPack * qty;

        // 4. İşlem Türüne Göre Kontrol (Envanterden mi Puanla mı?)
        if (useInventory) {
            // A) Envanterden Paket Açma
            const currentPacks = (user.inventory && user.inventory[packType]) || 0;
            
            if (currentPacks < qty) {
                // HATA: Yeterli paket yok
                return res.status(400).json({ 
                    error: `Insufficient ${packType} packs. You have ${currentPacks}, trying to open ${qty}.` 
                });
            }
            
            // Paketi düş
            user.inventory[packType] -= qty;
            if (user.inventory[packType] <= 0) delete user.inventory[packType];
            
            // Log
            user.logs = user.logs || [];
            user.logs.push({ type: 'system', date: now.slice(0, 10), note: `Opened ${qty} ${packType} packs` });

        } else {
            // B) Puanla Satın Alma
            const availablePoints = (user.bankPoints || 0) + (user.giftPoints || 0);
            
            if (availablePoints < totalCost) {
                // HATA: Yeterli puan yok
                return res.status(400).json({ 
                    error: `Insufficient points. Have ${availablePoints}, need ${totalCost}.` 
                });
            }

            // Puanı Düş (Önce Hediye Puanı, Sonra Ana Bakiye)
            let remainingCost = totalCost;
            
            if ((user.giftPoints || 0) > 0) {
                const useGift = Math.min(user.giftPoints, remainingCost);
                user.giftPoints -= useGift;
                remainingCost -= useGift;
            }
            
            if (remainingCost > 0) {
                user.bankPoints = Math.max(0, (user.bankPoints || 0) - remainingCost);
            }

            // Log
            user.logs = user.logs || [];
            user.logs.push({ type: 'system', date: now.slice(0, 10), note: `Bought ${qty} ${packType} packs with points` });
        }

        // 5. KART ÜRETİMİ (RNG)
        const newCards: string[] = [];
        const totalCardsToGive = qty * 5; // Her pakette 5 kart

        if (TOKENS && TOKENS.length > 0) {
            for (let i = 0; i < totalCardsToGive; i++) {
                // Rastgele bir token seç
                const randomToken = TOKENS[Math.floor(Math.random() * TOKENS.length)];
                newCards.push(randomToken.id);
                
                // Kullanıcı envanterine ekle
                user.inventory = user.inventory || {};
                user.inventory[randomToken.id] = (user.inventory[randomToken.id] || 0) + 1;
            }
        } else {
            console.error("⚠️ [Oracle] TOKENS listesi boş! Kart üretilemedi.");
        }

        // Güncelleme Zamanı
        user.updatedAt = now;

        // 6. Son Veriyi Kaydet
        await kv.hset('USERS', { [cleanId]: user });

        console.log(`✅ [Oracle] Purchase success for ${cleanId}. Items: ${newCards.length}`);

        return res.status(200).json({ ok: true, user, newCards });

    } catch (error: any) {
        console.error('[Oracle] Critical Purchase Error:', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
