import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

// Güvenlik için şifre (Environment Variable'dan gelecek)
const ORACLE_SECRET = process.env.ORACLE_SECRET; 

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Sadece POST isteği
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Güvenlik Kontrolü: Frontend doğru şifreyi gönderdi mi?
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ORACLE_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized: Invalid Secret' });
    }

    try {
        const { address, userData } = req.body;

        if (!address || !userData) {
            return res.status(400).json({ error: 'Missing data' });
        }

        const cleanAddress = address.toLowerCase();

        // 1. Mevcut kullanıcıyı çek (Varsa üzerine yazacağız, yoksa oluşturacağız)
        const existingUser: any = await kv.hget('USERS', cleanAddress) || {};

        // 2. Verileri birleştir (Merge)
        const updatedUser = {
            ...existingUser,
            ...userData,
            id: cleanAddress, // ID her zaman cüzdan adresidir
            updatedAt: new Date().toISOString()
        };

        // 3. Redis'e geri kaydet
        await kv.hset('USERS', { [cleanAddress]: updatedUser });

        console.log(`✅ [Oracle] User updated: ${cleanAddress}`);

        return res.status(200).json({ success: true, user: updatedUser });

    } catch (error: any) {
        console.error('[Oracle] Update User Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
