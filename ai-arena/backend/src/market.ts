export interface MarketSnapshot {
  cycleId: number;
  price: number;
  timestamp: number;
  sma10: number;
  sma30: number;
  momentum: number;    // positive = uptrend, negative = downtrend
  volatility: number;  // 0-1 range
  priceHistory: number[];
}

const priceHistory: number[] = [];

export async function fetchMarketSnapshot(cycleId: number): Promise<MarketSnapshot> {
  const price = await fetchSolPrice();
  priceHistory.push(price);

  // Keep last 50 prices
  if (priceHistory.length > 50) priceHistory.shift();

  const sma10 = computeSMA(priceHistory, 10);
  const sma30 = computeSMA(priceHistory, 30);
  const momentum = computeMomentum(priceHistory, 5);
  const volatility = computeVolatility(priceHistory, 10);

  return {
    cycleId,
    price,
    timestamp: Math.floor(Date.now() / 1000),
    sma10,
    sma30,
    momentum,
    volatility,
    priceHistory: [...priceHistory.slice(-10)],
  };
}

async function fetchSolPrice(): Promise<number> {
  try {
    const resp = await fetch(
      "https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112"
    );
    const data: any = await resp.json();
    const solData = data?.data?.["So11111111111111111111111111111111111111112"];
    if (solData?.price) {
      return parseFloat(solData.price);
    }
  } catch (err) {
    console.error("Jupiter price fetch failed, using fallback:", err);
  }

  // Fallback: use last known price or mock
  if (priceHistory.length > 0) {
    const last = priceHistory[priceHistory.length - 1];
    // Add small random variance for demo
    return last * (1 + (Math.random() - 0.5) * 0.005);
  }
  return 140 + Math.random() * 20; // mock $140-160 range
}

function computeSMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function computeMomentum(prices: number[], period: number): number {
  if (prices.length < 2) return 0;
  const current = prices[prices.length - 1];
  const past = prices[Math.max(0, prices.length - period - 1)];
  return (current - past) / past;
}

function computeVolatility(prices: number[], period: number): number {
  const slice = prices.slice(-period);
  if (slice.length < 2) return 0;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance =
    slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance) / mean; // coefficient of variation
}
