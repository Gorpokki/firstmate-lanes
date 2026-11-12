import { describe, expect, test } from "bun:test";
import { stamp } from "./time.ts";

describe("stamp", () => {
	test("formats leap-year day and afternoon time", () => {
		expect(stamp("2024-02-29T13:05:00Z")).toEqual({
			stardate: "2024.060.5",
			localTime: "Thu Feb 29, 1:05 PM",
		});
	});

	test("keeps midnight and noon at the 12-hour boundary", () => {
		expect(stamp("2024-01-01T00:00:00Z").localTime).toBe("Mon Jan 1, 12:00 AM");
		expect(stamp("2024-01-01T12:00:00Z").localTime).toBe("Mon Jan 1, 12:00 PM");
	});

	test("preserves unparseable input for display", () => {
		expect(stamp("unknown")).toEqual({ stardate: "", localTime: "unknown" });
	});
});
