import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${ORACLE_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const body = typeof req.body === 'object' ? req.body : {};
    const resetUsers = Boolean(body.resetUsers);

    // Clear current leaderboard and set today's daily to empty
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);

    await kv.set('LEADERBOARD_CURRENT', JSON.stringify([]));
    await kv.set(`LEADERBOARD_DAILY:${dayKey}`, JSON.stringify([]));
    await kv.set('LEADERBOARD_LAST_RUN', now.toISOString());

    let updatedCount = 0;

    if (resetUsers) {
      const allUsersObj = (await kv.hgetall('USERS')) || {};
      const entries = Object.entries(allUsersObj);

      // iterate and reset point fields
      for (const [id, userAny] of entries) {
        const user = (userAny as any) || {};
        user.totalPoints = 0;
        user.bankPoints = 0;
        user.giftPoints = 0;
        user.updatedAt = new Date().toISOString();
        await kv.hset('USERS', { [id]: user });
        updatedCount++;
      }
      console.log(`[Oracle] Reset points for ${updatedCount} users.`);
    }

    return res.status(200).json({
      success: true,
      resetUsers,
      updatedCount,
      timestamp: now.toISOString()
    });
  } catch (err: any) {
    console.error('[Oracle] reset-leaderboard error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
