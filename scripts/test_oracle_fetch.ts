
import { PriceOrchestrator } from '../lib/price_orchestrator';

async function test() {
    console.log("🚀 Starting Oracle Price Fetch Test...");
    const orchestrator = new PriceOrchestrator();

    // Using a mocked timer for testing would be better, but we'll just run it
    // This might take a while if it fetches ALL tokens. 
    // We can try to modify it to fetch just one for testing, but the class doesn't expose that easily.
    // However, we just want to see if it crashes or if it finds pairs.

    try {
        const prices = await orchestrator.fetchAllPrices();
        console.log(`✅ Fetched ${prices.length} prices`);

        // Check for a token that usually fails (e.g. VIRTUAL or one without a pair)
        const virtual = prices.find(p => p.symbol === 'VIRTUAL');
        if (virtual) {
            console.log("✅ Found VIRTUAL:", virtual);
        } else {
            console.warn("⚠️ VIRTUAL not found in results");
        }

    } catch (e) {
        console.error("❌ Test Failed:", e);
    }
}

test();
