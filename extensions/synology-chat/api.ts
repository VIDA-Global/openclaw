export { synologyChatPlugin } from "./src/channel.js";
export { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
export { DEFAULT_ACCOUNT_ID, setAccountEnabledInConfigSection } from "openclaw/plugin-sdk/core";
export {
  createFixedWindowRateLimiter,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  registerPluginHttpRoute,
  requestBodyErrorToText,
  type FixedWindowRateLimiter,
} from "openclaw/plugin-sdk/webhook-ingress";
export { setSynologyRuntime } from "./src/runtime.js";
export { collectSynologyChatSecurityAuditFindings } from "./src/security-audit.js";
export { synologyChatSetupAdapter, synologyChatSetupWizard } from "./src/setup-surface.js";
