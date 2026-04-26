export class ConfigStore {

    public static readonly instance = new ConfigStore();

    private _passiveReflectionsOnly = false;

    private _probeOutOfScopeRequests = false;

    private _logUnconfirmedFindings = false;

    private _checkResponseHeaderReflections = true;

    private _checkRequestHeaderReflections = true;

    private _checkPathSegmentReflections = true;

    private _noSniffContentTypes: Set<string> = new Set<string>();

    private _pathBlocklist: string[] = [];

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

    static getCheckRequestHeaderReflections(): boolean {
        return ConfigStore.instance._checkRequestHeaderReflections;
    }

    static setCheckRequestHeaderReflections(value: boolean) {
        ConfigStore.instance._checkRequestHeaderReflections = value;
    }

    static getCheckPathSegmentReflections(): boolean {
        return ConfigStore.instance._checkPathSegmentReflections;
    }

    static setCheckPathSegmentReflections(value: boolean) {
        ConfigStore.instance._checkPathSegmentReflections = value;
    }

    static getLogUnconfirmedFindings(): boolean {
        return ConfigStore.instance._logUnconfirmedFindings;
    }

    static setLogUnconfirmedFindings(value: boolean) {
        ConfigStore.instance._logUnconfirmedFindings = value;
    }

    static getNoSniffContentTypes(): Set<string> {
        return ConfigStore.instance._noSniffContentTypes;
    }

    static setNoSniffContentTypes(value: Set<string>) {
        ConfigStore.instance._noSniffContentTypes = value;
    }

    static getPathBlocklist(): string[] {
        return ConfigStore.instance._pathBlocklist;
    }

    static setPathBlocklist(value: string[]) {
        ConfigStore.instance._pathBlocklist = value;
    }

    static getPassiveReflectionsOnly(): boolean {
        return ConfigStore.instance._passiveReflectionsOnly;
    }

    static setPassiveReflectionsOnly(value: boolean) {
        ConfigStore.instance._passiveReflectionsOnly = value;
    }

    constructor() {
    }

}