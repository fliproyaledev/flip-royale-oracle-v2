// Oracle Update: pages/api/users/open-pack.ts
// Bu kodu Oracle projesindeki pages/api/users/open-pack.ts dosyasına yapıştırın ve deploy edin.
import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { TOKENS } from '../../../lib/tokens';
const ORACLE_SECRET = process.env.ORACLE_SECRET;
// Card type constants
const BASIC_TYPES = ['Sentient', 'Pegasus', 'Firstborn'];
const GENESIS_TYPE = 'Genesis';
const UNICORN_TYPE = 'Unicorn';
// Helper: Filter tokens by their type (about field) - CASE INSENSITIVE & ROBUST
function getCardsByType(tokens: any[], types: string[]): any[] {
    const lowerTypes = types.map(t => t.toLowerCase());
    return tokens.filter(t => t.about && lowerTypes.includes(t.about.toLowerCase().trim()));
}
function randInt(max: number) {
    return Math.floor(Math.random() * max);
}
/**
 * Generate cards based on pack type with STRICT enforcement.
 * NO FALLBACKS for typed packs (Unicorn, Genesis, Sentient).
 */
function generatePackCards(packType: string, tokens: any[]): string[] {
    if (!tokens || tokens.length === 0) return [];
    const cards: string[] = [];
    const pType = packType.toLowerCase().trim();
    // Helper for safer filtering
    const filterBy = (keywords: string[]) =>
        tokens.filter(t => t.about && keywords.some(k => t.about.toLowerCase().includes(k.toLowerCase())));
    // Pre-calculate pools
    const unicornCards = filterBy(['unicorn']);
    const genesisCards = filterBy(['genesis']);
    const sentientCards = filterBy(['sentient']);
    const basicCards = filterBy(['sentient', 'pegasus', 'firstborn']);
    console.log(`[PackGen] Type: ${pType} | Pools -> Unicorn: ${unicornCards.length}, Genesis: ${genesisCards.length}, Sentient: ${sentientCards.length}, Basic: ${basicCards.length}, Total: ${tokens.length}`);
    for (let i = 0; i < 5; i++) {
        let pool: any[] = [];
        // STRICT TYPE SELECTION - NO FALLBACKS
        if (pType.includes('unicorn')) {
            pool = unicornCards;
            if (pool.length === 0) throw new Error(`CRITICAL: No Unicorn cards found in database!`);
        }
        else if (pType.includes('genesis')) {
            pool = genesisCards;
            if (pool.length === 0) throw new Error(`CRITICAL: No Genesis cards found in database!`);
        }
        else if (pType.includes('sentient')) {
            pool = sentientCards;
            if (pool.length === 0) throw new Error(`CRITICAL: No Sentient cards found in database!`);
        }
        else if (pType.includes('rare')) {
            // Rare: 40% Basic, 35% Genesis, 25% Unicorn
            const roll = Math.random() * 100;
            if (roll < 40) pool = basicCards;
            else if (roll < 75) pool = genesisCards;
            else pool = unicornCards;
        }
        else {
            // Common: 50% Basic, 40% Genesis, 10% Unicorn
            const roll = Math.random() * 100;
            if (roll < 50) pool = basicCards;
            else if (roll < 90) pool = genesisCards;
            else pool = unicornCards;
        }
        // Safety check for empty pool (should only happen if database is empty for Basic/Genesis)
        if (pool.length === 0) {
            console.warn(`[PackGen] Empty pool for ${pType}. Fallback to random.`);
            pool = tokens;
        }
        // Pick random
        const selected = pool[randInt(pool.length)];
        if (selected) cards.push(selected.id);
    }
    return cards;
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    // Authorization check
    if (req.headers.authorization !== `Bearer ${ORACLE_SECRET}`) {
        // Fallback for debugging if secret mismatch (optional, but keep it strict for prod)
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const { userId, packType } = req.body;
        const cleanId = String(userId).toLowerCase();
        const packKey = `${packType}_pack`; // common_pack, unicorn_pack...
        const user: any = await kv.hget('USERS', cleanId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        // 1. Check Inventory
        // Handle both "unicorn" and "unicorn_pack" naming conventions just in case
        let currentPacks = (user.inventory && user.inventory[packKey]) || 0;
        if (currentPacks < 1) {
            // Try strict packType if packKey fails
            if (user.inventory && user.inventory[packType] > 0) {
                // Found it under raw name
            } else {
                return res.status(400).json({ error: `No ${packType} packs to open` });
            }
        }
        // 2. Decrement Pack
        if (user.inventory[packKey] > 0) {
            user.inventory[packKey] -= 1;
            if (user.inventory[packKey] <= 0) delete user.inventory[packKey];
        } else if (user.inventory[packType] > 0) {
            user.inventory[packType] -= 1;
            if (user.inventory[packType] <= 0) delete user.inventory[packType];
        }
        // 3. Generate Cards
        const newCards: string[] = generatePackCards(packType, TOKENS);
        // 4. Add to Inventory
        for (const tokenId of newCards) {
            user.inventory[tokenId] = (user.inventory[tokenId] || 0) + 1;
        }
        // 5. Save
        await kv.hset('USERS', { [cleanId]: user });
        console.log(`✅ [Oracle] Opened ${packType} pack for ${cleanId}`);
        return res.status(200).json({ ok: true, user, newCards });
    } catch (error: any) {
        console.error('[Oracle Error]', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
