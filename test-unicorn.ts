
const fs = require('fs');
const path = require('path');

// Mock data loading
const tokenListPath = path.join(__dirname, 'data/token-list.json');
const rawFile = fs.readFileSync(tokenListPath, 'utf8');
const tokenListRaw = JSON.parse(rawFile.replace(/^\uFEFF/, ''));

// Copy of rowToToken logic from lib/tokens.ts
function cleanAddress(input: any) {
    if (!input) return undefined;
    const match = input.match(/0x[a-fA-F0-9]{40}/);
    return match ? match[0].toLowerCase() : undefined;
}

function rowToToken(row: any) {
    const name = String(row['CARD NAME / TOKEN NAME'] || row['name'] || '').trim()
    const symbol = String(row['TICKER'] || row['symbol'] || '').replace(/\$/g, '').trim().toUpperCase()
    const rawLink = String(row['GECKO TERMINAL POOL LINK'] || row['dexscreenerPair'] || '').trim()

    let cleanPair = cleanAddress(rawLink)

    if (!cleanPair && rawLink.includes('/')) {
        const match = rawLink.match(/0x[a-fA-F0-9]{40}/i);
        if (match) cleanPair = match[0].toLowerCase();
    }

    return {
        id: symbol,
        symbol,
        dexscreenerPair: cleanPair
    }
}

async function test() {
    const rows = (tokenListRaw as any).Sayfa1 || [];
    const atmRow = rows.find((r: any) => r.TICKER === '$ATM');

    if (!atmRow) {
        console.log('ATM token not found in list!');
        return;
    }

    const token = rowToToken(atmRow);
    console.log('Parsed Token:', token);

    if (!token.dexscreenerPair) {
        console.log('FAIL: No pair extracted!');
    } else {
        console.log('SUCCESS: Pair extracted:', token.dexscreenerPair);

        // Try fetching
        const url = `https://api.dexscreener.com/latest/dex/pairs/base/${token.dexscreenerPair}`;
        console.log('Fetching:', url);
        const res = await fetch(url);
        const json = await res.json();
        console.log('API Response:', JSON.stringify(json, null, 2).slice(0, 500) + '...');
    }
}

test();
