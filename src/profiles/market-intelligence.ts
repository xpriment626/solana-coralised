import { definePluginSelection } from "../agent-kit/index.js";

export const marketIntelligenceProfile = definePluginSelection({
  profileName: "market-intelligence",
  plugins: ["@solana-agent-kit/plugin-misc", "@solana-agent-kit/plugin-token"],
  allowedActions: [
    "getCoingeckoTokenInfo",
    "getCoingeckoTokenPriceData",
    "getCoingeckoTrendingTokens",
    "pythFetchPrice",
    "getAssetsByOwner",
  ],
});
