import { tool } from "ai";
import { z } from "zod";

const HERMES_URL = "https://hermes.pyth.network";

export const tools = {
  pyth_get_price: tool({
    description:
      "Get the latest price from Pyth oracle feeds. Returns price, confidence interval, and EMA price. Use pyth_search_price_feeds first if you don't know the feed ID.",
    parameters: z.object({
      feedIds: z
        .array(z.string())
        .describe(
          "Array of Pyth price feed IDs (hex strings with 0x prefix). Example: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' for SOL/USD"
        ),
    }),
    execute: async ({ feedIds }) => {
      const params = feedIds.map((id) => `ids[]=${id}`).join("&");
      const res = await fetch(
        `${HERMES_URL}/v2/updates/price/latest?${params}&parsed=true`
      );
      if (!res.ok) return { error: `Pyth Hermes error ${res.status}` };
      const data = await res.json();
      return (
        data.parsed?.map((p: any) => ({
          id: p.id,
          price:
            Number(p.price.price) * Math.pow(10, p.price.expo),
          confidence:
            Number(p.price.conf) * Math.pow(10, p.price.expo),
          expo: p.price.expo,
          publishTime: p.price.publish_time,
          emaPrice:
            Number(p.ema_price.price) *
            Math.pow(10, p.ema_price.expo),
        })) ?? data
      );
    },
  }),

  pyth_search_price_feeds: tool({
    description:
      "Search for Pyth price feed IDs by asset name (e.g. 'SOL', 'BTC', 'ETH'). Returns feed IDs you can pass to pyth_get_price.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Search query — asset name or symbol (e.g. 'SOL', 'Bitcoin')"
        ),
    }),
    execute: async ({ query }) => {
      const res = await fetch(
        `${HERMES_URL}/v2/price_feeds?query=${encodeURIComponent(query)}&asset_type=crypto`
      );
      if (!res.ok) return { error: `Pyth Hermes error ${res.status}` };
      const feeds = await res.json();
      return feeds.slice(0, 10).map((f: any) => ({
        id: `0x${f.id}`,
        symbol: f.attributes?.symbol ?? f.attributes?.base,
        assetType: f.attributes?.asset_type,
      }));
    },
  }),
};
