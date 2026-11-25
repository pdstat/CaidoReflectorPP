import { ConfigStore } from "../src/stores/configStore.js";

describe("ConfigStore probe limits", () => {
  afterEach(() => {
    ConfigStore.setProbeConcurrency(2);
    ConfigStore.setProbeRatePerSecond(5);
  });

  test("defaults are 2 in flight and 5 requests/s", () => {
    expect(ConfigStore.getProbeConcurrency()).toBe(2);
    expect(ConfigStore.getProbeRatePerSecond()).toBe(5);
  });

  test("accepts valid values, including rate 0 (uncapped)", () => {
    ConfigStore.setProbeConcurrency(8);
    ConfigStore.setProbeRatePerSecond(0);
    expect(ConfigStore.getProbeConcurrency()).toBe(8);
    expect(ConfigStore.getProbeRatePerSecond()).toBe(0);
    ConfigStore.setProbeRatePerSecond(2.5);
    expect(ConfigStore.getProbeRatePerSecond()).toBe(2.5);
  });

  test.each([0, -1, 1.5, 51, Number.NaN])("rejects concurrency %p", (value) => {
    expect(() => ConfigStore.setProbeConcurrency(value)).toThrow(/Probe concurrency/);
    expect(ConfigStore.getProbeConcurrency()).toBe(2);
  });

  test.each([-1, 1001, Number.NaN, Number.POSITIVE_INFINITY])("rejects rate %p", (value) => {
    expect(() => ConfigStore.setProbeRatePerSecond(value)).toThrow(/Probe rate/);
    expect(ConfigStore.getProbeRatePerSecond()).toBe(5);
  });
});
