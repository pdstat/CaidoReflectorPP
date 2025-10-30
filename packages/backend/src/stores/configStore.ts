export class ConfigStore {

    public static readonly instance = new ConfigStore();

    private _probeOutOfScopeRequests = false;

    private _checkResponseHeaderReflections = true;

    private _noSniffContentTypes: Set<string> = new Set<string>();

    static getProbeOutOfScopeRequests(): boolean {
        return ConfigStore.instance._probeOutOfScopeRequests;
    }

    static setProbeOutOfScopeRequests(value: boolean) {
        ConfigStore.instance._probeOutOfScopeRequests = value;
    }

    static getCheckResponseHeaderReflections(): boolean {
        return ConfigStore.instance._checkResponseHeaderReflections;
    }

    static setCheckResponseHeaderReflections(value: boolean) {
        ConfigStore.instance._checkResponseHeaderReflections = value;
    }

    static getNoSniffContentTypes(): Set<string> {
        return ConfigStore.instance._noSniffContentTypes;
    }

    static setNoSniffContentTypes(value: Set<string>) {
        ConfigStore.instance._noSniffContentTypes = value;
    }

    constructor() {
    }

}