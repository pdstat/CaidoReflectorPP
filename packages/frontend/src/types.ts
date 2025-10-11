import { type Caido } from "@caido/sdk-frontend";
import { type API } from "backend";
import { PluginSettings } from "./settings";

export type FrontendSDK = Caido<API, Record<string, never>>;

export class Reflector {
    public static sdk: FrontendSDK;
    public static settings: PluginSettings

    public static init(sdk: FrontendSDK) {
        this.sdk = sdk;
        this.settings = new PluginSettings(sdk);
    }
}
