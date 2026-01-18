// Oracle Update: pages/api/users/open-pack.ts
// Bu kodu Oracle projesindeki open-pack.ts dosyasına yapıştırın
import type { NextApiRequest, NextApiResponse } from 'next';
import { kv } from '@vercel/kv';
import { TOKENS } from '../../../lib/tokens';
const ORACLE_SECRET = process.env.ORACLE_SECRET;
// Card type constants
const BASIC_TYPES = ['Sentient', 'Pegasus', 'Firstborn'];
const GENESIS_TYPE = 'Genesis';
const UNICORN_TYPE = 'Unicorn';
// Filter tokens by their type (about field)
function getCardsByType(tokens: any[], types: string[]): any[] {
    return tokens.filter(t => types.includes(t.about));
}
function randInt(max: number) {
    return Math.floor(Math.random() * max);
}
/**
 * Generate cards based on pack type with specific drop rates:
 * - Unicorn Pack: 100% Unicorn cards
 * - Genesis Pack: 100% Genesis cards
 * - Sentient Pack: 100% Sentient cards
 * - Common Pack: 50% Basic (Sentient/Pegasus/Firstborn), 40% Genesis, 10% Unicorn
 * - Rare Pack: 40% Basic, 35% Genesis, 25% Unicorn
 */
function generatePackCards(packType: string, tokens: any[]): string[] {
    if (!tokens || tokens.length === 0) return [];
    const cards: string[] = [];
    // Pre-filter tokens by type
    const basicCards = getCardsByType(tokens, BASIC_TYPES);
    const genesisCards = getCardsByType(tokens, [GENESIS_TYPE]);
    const unicornCards = getCardsByType(tokens, [UNICORN_TYPE]);
    const sentientCards = getCardsByType(tokens, ['Sentient']);
    for (let i = 0; i < 5; i++) {
        let pool: any[];
        switch (packType.toLowerCase()) {
            case 'unicorn':
                pool = unicornCards;
                break;
            case 'genesis':
                pool = genesisCards;
                break;
            case 'sentient':
                pool = sentientCards;
                break;
            case 'rare':
                // 40% basic, 35% genesis, 25% unicorn
                const rareRoll = Math.random() * 100;
                if (rareRoll < 40) pool = basicCards;
                else if (rareRoll < 75) pool = genesisCards;
                else pool = unicornCards;
                break;
            case 'common':
            default:
                // 50% basic, 40% genesis, 10% unicorn
                const commonRoll = Math.random() * 100;
                if (commonRoll < 50) pool = basicCards;
                else if (commonRoll < 90) pool = genesisCards;
                else pool = unicornCards;
                break;
        }
        // Pick random card from pool (fallback to all tokens if pool empty)
        if (pool.length > 0) {
            cards.push(pool[randInt(pool.length)].id);
        } else {
            cards.push(tokens[randInt(tokens.length)].id);
        }
    }
    return cards;
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (req.headers.authorization !== `Bearer ${ORACLE_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { userId, packType } = req.body;
        const cleanId = String(userId).toLowerCase();
        const packKey = `${packType}_pack`; // common_pack, unicorn_pack, etc.
        const user: any = await kv.hget('USERS', cleanId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        // 1. Paketi var mı?
        const currentPacks = (user.inventory && user.inventory[packKey]) || 0;
        if (currentPacks < 1) {
            return res.status(400).json({ error: `No ${packType} packs to open` });
        }
        // 2. Paketi düş
        user.inventory[packKey] -= 1;
        if (user.inventory[packKey] <= 0) delete user.inventory[packKey];
        // 3. Kartları Üret - PACK TYPE'A GÖRE
        const newCards: string[] = generatePackCards(packType, TOKENS);
        for (const tokenId of newCards) {
            user.inventory[tokenId] = (user.inventory[tokenId] || 0) + 1;
        }
        await kv.hset('USERS', { [cleanId]: user });
        console.log(`✅ [Oracle] Opened ${packType} pack for ${cleanId}, cards: ${newCards.join(', ')}`);
        return res.status(200).json({ ok: true, user, newCards });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}
