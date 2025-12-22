import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const ORACLE_SECRET = process.env.ORACLE_SECRET;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const authHeader = req.headers.authorization;
  const providedSecret = authHeader?.replace('Bearer ', '');
  
  if (providedSecret !== ORACLE_SECRET) {
    console.error('[Oracle] Unauthorized attempt to get all users');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[Oracle] Fetching all users from KV...');
    
    // Fetch all users from USERS hash
    const allUsersObj = (await kv.hgetall('USERS')) || {};
    const users = Object.values(allUsersObj);
    
    console.log(`[Oracle] Found ${users.length} users`);
    
    return res.status(200).json({
      ok: true,
      users,
      count: users.length
    });
    
  } catch (error: any) {
    console.error('[Oracle] Get All Users Error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
}
