import { StorageSDK } from "@caido/sdk-frontend/src/types/storage";
import { FrontendSDK } from "@/types";
import type { API } from "../../backend/src/index.ts";

const PROBE_OOS_STORAGE_KEY = "probeOutOfScope"

export class PluginSettings {

    private storage: StorageSDK;
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

    public getProbeOutOfScope(): boolean {
        return this.get<boolean>(PROBE_OOS_STORAGE_KEY, false);
    }

    public async setProbeOutOfScope(value: boolean): Promise<void> {
        await this.sdk.backend.setProbeOutOfScope(value);
        return this.set<boolean>(PROBE_OOS_STORAGE_KEY, value);
    }

};