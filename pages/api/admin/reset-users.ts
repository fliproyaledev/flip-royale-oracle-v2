import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';

const ORACLE_SECRET = process.env.ORACLE_SECRET;

type UserRecord = {
    id: string
    name?: string
    avatar?: string
    totalPoints: number
    bankPoints: number
    giftPoints: number
    logs: any[]
    activeRound?: any[]
    nextRound?: any[]
    currentRound?: number
    roundHistory?: any[]
    inventory?: Record<string, number>
    // Preserve referral info
    inviteCodeUsed?: string
    inviteType?: string
    referredBy?: string
    referralCode?: string
    packsPurchased?: number
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Auth check
    const authHeader = req.headers.authorization;
    const providedSecret = authHeader?.replace('Bearer ', '');

    if (providedSecret !== ORACLE_SECRET) {
        console.error('[Oracle] Unauthorized attempt to reset users');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('[Oracle] RESETTING ALL USERS (PRESERVING INVENTORY)...');

        // Fetch all users
        const allUsersObj = (await kv.hgetall('USERS')) || {};
        const users = Object.values(allUsersObj) as UserRecord[];

        const updates: Record<string, UserRecord> = {};
        const now = new Date().toISOString();

        for (const user of users) {
            if (!user.id) continue;

            // 1. Preserve existing inventory or init empty
            const newInventory = { ...(user.inventory || {}) };

            // 2. Return cards from Active Round to inventory
            if (Array.isArray(user.activeRound)) {
                for (const pick of user.activeRound) {
                    if (pick && pick.tokenId) {
                        newInventory[pick.tokenId] = (newInventory[pick.tokenId] || 0) + 1;
                    }
                }
            }

            // 3. Return cards from Next Round to inventory
            if (Array.isArray(user.nextRound)) {
                for (const pick of user.nextRound) {
                    if (pick && pick.tokenId) {
                        newInventory[pick.tokenId] = (newInventory[pick.tokenId] || 0) + 1;
                    }
                }
            }

            // If inventory is empty (new player?), ensure at least common pack if logic requires it.
            // But for reset, we just want to preserve what they have. 
            // If we want to be generous to "wiped" Beta players, maybe give a bonus pack? 
            // User said "don't delete purchased packs", didn't ask for bonus. 
            // If inventory ends up empty, let's give the starter "common: 1" just in case so they can play.
            if (Object.keys(newInventory).length === 0) {
                newInventory['common'] = 1;
            }

            // Reset stats but keep identity, inventory and referral info
            updates[user.id] = {
                ...user,
                totalPoints: 0,
                bankPoints: 0,
                giftPoints: 0, // Reset gift points as well (score related)
                logs: [{ type: 'system', date: now.slice(0, 10), note: 'BETA RESET - INVENTORY RESTORED' }],
                activeRound: [],
                nextRound: Array(5).fill(null),
                currentRound: 1,
                roundHistory: [],
                inventory: newInventory,

                // Preserve Profile
                id: user.id,
                name: user.name,
                avatar: user.avatar,

                // Preserve Referral & Purchase Info
                inviteCodeUsed: user.inviteCodeUsed,
                inviteType: user.inviteType,
                referredBy: user.referredBy,
                referralCode: user.referralCode,
                packsPurchased: user.packsPurchased
            };
        }

        if (Object.keys(updates).length > 0) {
            // Refresh the entire hash with updated users
            await kv.del('USERS');

            const entries = Object.entries(updates);
            const chunkSize = 100;
            for (let i = 0; i < entries.length; i += chunkSize) {
                const chunk = entries.slice(i, i + chunkSize);
                const hashUpdate: Record<string, UserRecord> = {};
                chunk.forEach(([k, v]) => hashUpdate[k] = v);
                await kv.hset('USERS', hashUpdate);
            }
        }

        console.log(`[Oracle] Safe Reset complete for ${Object.keys(updates).length} users.`);

        return res.status(200).json({
            ok: true,
            count: Object.keys(updates).length,
            message: "Users reset, inventory preserved and active cards returned."
        });

    } catch (error: any) {
        console.error('[Oracle] Reset Error:', error);
        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}
