import type { DefineAPI, SDK } from "caido:plugin";
import type { Request, Response } from "caido:utils";
import { run as reflectorRun } from "./reflector++.js";
import { ConfigStore } from "./stores/configStore.js";
import { probeLimiter, type ThrottledHost } from "./net/probeLimiter.js";

export type API = DefineAPI<{
    setEnabled: (sdk: SDK, value: boolean) => Promise<void>;
    setProbeOutOfScope: (sdk: SDK, value: boolean) => Promise<void>;
    setCheckResponseHeaderReflections: (sdk: SDK, value: boolean) => Promise<void>;
    setCheckJsResponseReflections: (sdk: SDK, value: boolean) => Promise<void>;
    setLogUnconfirmedFindings: (sdk: SDK, value: boolean) => Promise<void>;
    setNoSniffContentTypes: (sdk: SDK, value: string) => Promise<void>;
    setPathBlocklist: (sdk: SDK, value: string) => Promise<void>;
    setProbeConcurrency: (sdk: SDK, value: number) => Promise<void>;
    setProbeRatePerSecond: (sdk: SDK, value: number) => Promise<void>;
    getThrottledHosts: (sdk: SDK) => Promise<ThrottledHost[]>;
    resetThrottledHost: (sdk: SDK, host: string) => Promise<boolean>;
}>;

export function init(sdk: SDK<API>) {
    sdk.api.register("setEnabled", async (_sdk, value: boolean) => {
        ConfigStore.setEnabled(value)
    })
    sdk.api.register("setProbeOutOfScope", async (_sdk, value: boolean) => {
        ConfigStore.setProbeOutOfScopeRequests(value)
    })
    sdk.api.register("setNoSniffContentTypes", async (_sdk, value: string) => {
        const parsed = JSON.parse(value);
        ConfigStore.setNoSniffContentTypes(new Set(parsed));
    })
    sdk.api.register("setCheckResponseHeaderReflections", async (_sdk, value: boolean) => {
        ConfigStore.setCheckResponseHeaderReflections(value)
    })
    sdk.api.register("setCheckJsResponseReflections", async (_sdk, value: boolean) => {
        ConfigStore.setCheckJsResponseReflections(value)
    })
    sdk.api.register("setLogUnconfirmedFindings", async (_sdk, value: boolean) => {
        ConfigStore.setLogUnconfirmedFindings(value)
    })
    sdk.api.register("setPathBlocklist", async (_sdk, value: string) => {
        const parsed = JSON.parse(value);
        ConfigStore.setPathBlocklist(parsed);
    })
    sdk.api.register("setProbeConcurrency", async (_sdk, value: number) => {
        ConfigStore.setProbeConcurrency(value)
    })
    sdk.api.register("setProbeRatePerSecond", async (_sdk, value: number) => {
        ConfigStore.setProbeRatePerSecond(value)
    })
    sdk.api.register("getThrottledHosts", async () => probeLimiter.throttledHosts())
    sdk.api.register("resetThrottledHost", async (_sdk, host: string) => probeLimiter.resetHost(host))
    sdk.events.onInterceptResponse(async (sdk, request: Request, response: Response) => {
        if (!ConfigStore.getEnabled()) return;
        if (ConfigStore.getProbeOutOfScopeRequests() || sdk.requests.inScope(request)) {
            // Awaited: Caido stops running this plugin's queued promise jobs once the handler
            // settles, so an unawaited scan stalls at its next await until another event arrives.
            await reflectorRun({ request, response }, sdk).catch((e) => {
                sdk.console.error(`[Reflector++] Scan failed for ${request.getUrl()}: ${e}`);
            });
        }
    });
}