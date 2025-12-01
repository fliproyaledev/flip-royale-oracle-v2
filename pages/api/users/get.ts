import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Sadece GET isteği
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { address } = req.query;

    if (!address || typeof address !== 'string') {
        return res.status(400).json({ error: 'Missing address' });
    }

    try {
        const cleanAddress = address.toLowerCase();
        
        // Redis'ten kullanıcıyı çek (USERS hash map'inden)
        const user = await kv.hget('USERS', cleanAddress);

        if (!user) {
            return res.status(404).json({ exists: false });
        }

        return res.status(200).json({ exists: true, user });

    } catch (error: any) {
        console.error('[Oracle] Get User Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
