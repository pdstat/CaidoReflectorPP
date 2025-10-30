import type { DefineAPI, SDK } from "caido:plugin";
import type { Request, Response } from "caido:utils";
import { run as reflectorRun } from "./reflector++.js";
import { ConfigStore } from "./stores/configStore.js";


interface AsyncOperation<T> {
    (): Promise<T>;
}

interface WithTimeout {
    <T>(asyncOperation: AsyncOperation<T>, timeoutMs: number): Promise<T>;
}

const withTimeout: WithTimeout = (asyncOperation, timeoutMs) => {
    return Promise.race([
        asyncOperation(),
        new Promise<never>(
            (_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
};

export type API = DefineAPI<{
    setProbeOutOfScope: (value: boolean) => Promise<void>;
    setCheckResponseHeaderReflections: (value: boolean) => Promise<void>;
    setLogUnconfirmedFindings: (value: boolean) => Promise<void>;
    setNoSniffContentTypes: (value: Set<string>) => Promise<void>;
}>;

export function init(sdk: SDK<API>) {
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
    sdk.api.register("setLogUnconfirmedFindings", async (_sdk, value: boolean) => {
        ConfigStore.setLogUnconfirmedFindings(value)
    })
    sdk.events.onInterceptResponse(async (sdk, request: Request, response: Response) => {
        const shouldProbe = ConfigStore.getProbeOutOfScopeRequests();
        sdk.console.log(`Reflector++: shouldProbe=${shouldProbe}, inScope=${sdk.requests.inScope(request)}`);
        if ((!sdk.requests.inScope(request) && shouldProbe)
            || (sdk.requests.inScope(request))) {
            withTimeout(() => reflectorRun({ request, response }, sdk), 40_000);
        }
    });
}