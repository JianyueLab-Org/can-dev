import { afterEach, describe, expect, test } from "bun:test";

import { fsdOrigin } from "./config";

describe("fsdOrigin", () => {
  const previous = process.env.CAN_FSD_ORIGIN;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.CAN_FSD_ORIGIN;
    } else {
      process.env.CAN_FSD_ORIGIN = previous;
    }
  });

  test("defaults to the HTTP datafeed host, not the FSD socket", () => {
    delete process.env.CAN_FSD_ORIGIN;
    expect(fsdOrigin()).toBe("https://data.ceruleanavi.net");
  });

  test("strips a trailing slash from an override", () => {
    process.env.CAN_FSD_ORIGIN = "https://data.example.test/";
    expect(fsdOrigin()).toBe("https://data.example.test");
  });
});
