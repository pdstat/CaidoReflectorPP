import { NO_SNIFF_CONTENT_TYPES } from "./core/constants.js";
import { FrontendSDK } from "@/types";

const ENABLED_STORAGE_KEY = "enabled"
const PROBE_OOS_STORAGE_KEY = "probeOutOfScope"
const LOG_UNCONFIRMED_FINDINGS_STORAGE_KEY = "logUnconfirmedFindings"
const LOG_LOW_FINDINGS_STORAGE_KEY = "logLowFindings"
const CHECK_HEADER_REFLECTIONS_STORAGE_KEY = "checkResponseHeaderReflections"
const CHECK_JS_RESPONSE_REFLECTIONS_STORAGE_KEY = "checkJsResponseReflections"
const CONTENT_TYPES_STORAGE_KEY = "noSniffContentTypes"
const PATH_BLOCKLIST_STORAGE_KEY = "pathBlocklist"
const PROBE_CONCURRENCY_STORAGE_KEY = "probeConcurrency"
const PROBE_RATE_STORAGE_KEY = "probeRatePerSecond"

export const DEFAULT_PROBE_CONCURRENCY = 2
export const DEFAULT_PROBE_RATE_PER_SECOND = 5

export class PluginSettings {

    private storage: FrontendSDK["storage"];
    private sdk: FrontendSDK;

    constructor(private sdk: FrontendSDK) {
        this.storage = sdk.storage;
        this.sdk = sdk;
    }

    private getSettingsObj(): Record<string, any> {
        const settings = this.storage.get()

        if (!settings || typeof settings !== "object") {
            return {}
        }

        return (settings as Record<string, any>)
    }

    public get<T>(key: string, defaultValue?: T): T {
        return this.getSettingsObj()[key] ?? defaultValue;
    }

    public async set<T>(key: string, value: T): Promise<void> {
        const settings = this.getSettingsObj();

        settings[key] = value;

        return this.storage.set(settings);
    }

    public getEnabled(): boolean {
        return this.get<boolean>(ENABLED_STORAGE_KEY, true);
    }

    public async setEnabled(value: boolean): Promise<void> {
        await this.sdk.backend.setEnabled(value);
        return this.set<boolean>(ENABLED_STORAGE_KEY, value);
    }

    public getProbeOutOfScope(): boolean {
        return this.get<boolean>(PROBE_OOS_STORAGE_KEY, false);
    }

    public async setProbeOutOfScope(value: boolean): Promise<void> {
        await this.sdk.backend.setProbeOutOfScope(value);
        return this.set<boolean>(PROBE_OOS_STORAGE_KEY, value);
    }

    public getCheckResponseHeaderReflections(): boolean {
        return this.get<boolean>(CHECK_HEADER_REFLECTIONS_STORAGE_KEY, true);
    }

    public async setCheckResponseHeaderReflections(value: boolean): Promise<void> {
        await this.sdk.backend.setCheckResponseHeaderReflections(value);
        return this.set<boolean>(CHECK_HEADER_REFLECTIONS_STORAGE_KEY, value);
    }

    public getCheckJsResponseReflections(): boolean {
        return this.get<boolean>(CHECK_JS_RESPONSE_REFLECTIONS_STORAGE_KEY, true);
    }

    public async setCheckJsResponseReflections(value: boolean): Promise<void> {
        await this.sdk.backend.setCheckJsResponseReflections(value);
        return this.set<boolean>(CHECK_JS_RESPONSE_REFLECTIONS_STORAGE_KEY, value);
    }

    public getLogUnconfirmedFindings(): boolean {
        return this.get<boolean>(LOG_UNCONFIRMED_FINDINGS_STORAGE_KEY, false);
    }

    public async setLogUnconfirmedFindings(value: boolean): Promise<void> {
        await this.sdk.backend.setLogUnconfirmedFindings(value);
        return this.set<boolean>(LOG_UNCONFIRMED_FINDINGS_STORAGE_KEY, value);
    }

    public getLogLowFindings(): boolean {
        return this.get<boolean>(LOG_LOW_FINDINGS_STORAGE_KEY, false);
    }

    public async setLogLowFindings(value: boolean): Promise<void> {
        await this.sdk.backend.setLogLowFindings(value);
        return this.set<boolean>(LOG_LOW_FINDINGS_STORAGE_KEY, value);
    }

    public getDefaultNoSniffContentTypes(): Set<string> {
        return NO_SNIFF_CONTENT_TYPES;
    }

    public getNoSniffContentTypes(): Set<string> {
        const stored = this.get<Set<string>>(CONTENT_TYPES_STORAGE_KEY);
        if (stored && stored.size > 0) {
            return stored;
        } else {
            return this.getDefaultNoSniffContentTypes();
        }
    }

    public async setNoSniffContentTypes(value: Set<string>): Promise<void> {
        await this.sdk.backend.setNoSniffContentTypes(JSON.stringify(Array.from(value)));
        return this.set<Set<string>>(CONTENT_TYPES_STORAGE_KEY, value);
    }

    public getPathBlocklist(): string[] {
        return this.get<string[]>(PATH_BLOCKLIST_STORAGE_KEY, []);
    }

    public async setPathBlocklist(value: string[]): Promise<void> {
        await this.sdk.backend.setPathBlocklist(JSON.stringify(value));
        return this.set<string[]>(PATH_BLOCKLIST_STORAGE_KEY, value);
    }

    public getProbeConcurrency(): number {
        return this.get<number>(PROBE_CONCURRENCY_STORAGE_KEY, DEFAULT_PROBE_CONCURRENCY);
    }

    // The backend validates the value and rejects it before anything is stored.
    public async setProbeConcurrency(value: number): Promise<void> {
        await this.sdk.backend.setProbeConcurrency(value);
        return this.set<number>(PROBE_CONCURRENCY_STORAGE_KEY, value);
    }

    public getProbeRatePerSecond(): number {
        return this.get<number>(PROBE_RATE_STORAGE_KEY, DEFAULT_PROBE_RATE_PER_SECOND);
    }

    public async setProbeRatePerSecond(value: number): Promise<void> {
        await this.sdk.backend.setProbeRatePerSecond(value);
        return this.set<number>(PROBE_RATE_STORAGE_KEY, value);
    }

};