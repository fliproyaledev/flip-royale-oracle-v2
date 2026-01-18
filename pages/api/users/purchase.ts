import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ORACLE_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { userId, packType, count, paymentMethod, txHash } = req.body;
        const cleanId = String(userId).toLowerCase();
        const now = new Date().toISOString();

        // 1. Kullanıcıyı Bul veya Oluştur
        let user: any = await kv.hget('USERS', cleanId);
        if (!user) {
            console.log(`⚠️ [Oracle] Kullanıcı yok, oluşturuluyor: ${cleanId}`);
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
        // Varsayılan olarak common, eğer rare ise rare
        const VALID_PACK_TYPES = ['common', 'rare', 'unicorn', 'genesis', 'sentient'];
        const validatedPackType = VALID_PACK_TYPES.includes(packType) ? packType : 'common';
        const packKey = `${validatedPackType}_pack`; // 'common_pack' veya 'rare_pack'

        // 2. Ödeme İşlemleri (Puan Düşme vb.) - BURASI AYNI KALSIN
        // ... (Önceki kodundaki Puan/Kripto kontrol blokları) ...

        // 3. KRİTİK NOKTA: KART DEĞİL PAKET EKLİYORUZ
        user.inventory = user.inventory || {};
        // Burada randomToken.id DEĞİL, packKey (common_pack) ekliyoruz
        user.inventory[packKey] = (user.inventory[packKey] || 0) + qty;

        user.updatedAt = now;
        await kv.hset('USERS', { [cleanId]: user });

        console.log(`✅ [Oracle] ${qty} ${validatedPackType} packs added to ${cleanId}`);

        // newCards boş dönmeli ki frontend kartları göstermesin
        return res.status(200).json({ ok: true, user, newCards: [] });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}
