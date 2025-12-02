import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { key } = req.query;
  if (key !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Fetch all users from USERS hash
    // kv.hgetall returns an object mapping id -> user (or {} if empty)
    const allUsersObj = (await kv.hgetall('USERS')) || {};
    const entries = Object.entries(allUsersObj);

    // create array with score and metadata
    const usersWithScore = entries.map(([id, userAny]) => {
      const u = userAny as any;
      return {
        id,
        username: u?.username || u?.name || id,
        totalPoints: Number(u?.totalPoints || 0),
        bankPoints: Number(u?.bankPoints || 0),
        giftPoints: Number(u?.giftPoints || 0)
      };
    });

    // sort descending by totalPoints
    usersWithScore.sort((a, b) => b.totalPoints - a.totalPoints);

    // take top N
    const TOP_N = 100;
    const top = usersWithScore.slice(0, TOP_N).map((u, idx) => ({
      rank: idx + 1,
      id: u.id,
      username: u.username,
      totalPoints: u.totalPoints,
      bankPoints: u.bankPoints,
      giftPoints: u.giftPoints
    }));

    // date key (UTC YYYY-MM-DD)
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);

    // Persist
    await kv.set(`LEADERBOARD_DAILY:${dayKey}`, JSON.stringify(top));
    await kv.set('LEADERBOARD_CURRENT', JSON.stringify(top));
    await kv.set('LEADERBOARD_LAST_RUN', now.toISOString());

    console.log(`[Oracle] Leaderboard settled for ${dayKey}. Top: ${top.length}`);

    return res.status(200).json({
      success: true,
      dayKey,
      count: top.length,
      timestamp: now.toISOString()
    });
  } catch (err: any) {
    console.error('[Oracle] settle-leaderboard error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
