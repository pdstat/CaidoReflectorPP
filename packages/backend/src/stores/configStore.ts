export class ConfigStore {

    public static readonly instance = new ConfigStore();

    private _enabled = true;

    private _passiveReflectionsOnly = false;

    private _probeOutOfScopeRequests = false;

    private _logUnconfirmedFindings = false;

    private _logLowFindings = false;

    private _checkResponseHeaderReflections = true;

    private _checkRequestHeaderReflections = true;

    private _checkPathSegmentReflections = true;

    private _checkJsResponseReflections = true;

    private _noSniffContentTypes: Set<string> = new Set<string>();

    private _pathBlocklist: string[] = [];

    private _probeConcurrency = 2;

    private _probeRatePerSecond = 5;

    static getEnabled(): boolean {
        return ConfigStore.instance._enabled;
    }

    static setEnabled(value: boolean) {
        ConfigStore.instance._enabled = value;
    }

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

    static getCheckJsResponseReflections(): boolean {
        return ConfigStore.instance._checkJsResponseReflections;
    }

    static setCheckJsResponseReflections(value: boolean) {
        ConfigStore.instance._checkJsResponseReflections = value;
    }

    static getLogUnconfirmedFindings(): boolean {
        return ConfigStore.instance._logUnconfirmedFindings;
    }

    static setLogUnconfirmedFindings(value: boolean) {
        ConfigStore.instance._logUnconfirmedFindings = value;
    }

    static getLogLowFindings(): boolean {
        return ConfigStore.instance._logLowFindings;
    }

    static setLogLowFindings(value: boolean) {
        ConfigStore.instance._logLowFindings = value;
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

    static getProbeConcurrency(): number {
        return ConfigStore.instance._probeConcurrency;
    }

    static setProbeConcurrency(value: number) {
        if (!Number.isInteger(value) || value < 1 || value > 50) {
            throw new Error(`Probe concurrency must be an integer from 1 to 50, got ${value}`);
        }
        ConfigStore.instance._probeConcurrency = value;
    }

    static getProbeRatePerSecond(): number {
        return ConfigStore.instance._probeRatePerSecond;
    }

    // 0 means no rate cap (only the concurrency limit applies).
    static setProbeRatePerSecond(value: number) {
        if (!Number.isFinite(value) || value < 0 || value > 1000) {
            throw new Error(`Probe rate must be a number from 0 to 1000 requests/s, got ${value}`);
        }
        ConfigStore.instance._probeRatePerSecond = value;
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