import type { DefineAPI, SDK } from "caido:plugin";
import type { Request, Response } from "caido:utils";
import { run as reflectorRun } from "./reflector++.js";


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

export type API = DefineAPI<{}>;

export function init(sdk: SDK<API>) {
    sdk.events.onInterceptResponse((sdk, request: Request, response: Response) => {
        withTimeout(() => reflectorRun({ request, response }, sdk), 40_000);
    });
}