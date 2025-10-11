export class ConfigStore {

    public static readonly instance = new ConfigStore();

    private _probeOutOfScopeRequests = false;

    static getProbeOutOfScopeRequests(): boolean {
        return ConfigStore.instance._probeOutOfScopeRequests;
    }

    static setProbeOutOfScopeRequests(value: boolean) {
        ConfigStore.instance._probeOutOfScopeRequests = value;
    }

    constructor() {
    }

}