import { describe, expect, test } from "vitest";
import { berlinCalendarDay, nextBerlinCalendarDay, snoozeDueAt } from "../src/shared/berlin-date.js";

describe("Berlin snooze dates", () => {
  test("crosses the local date before UTC and preserves tomorrow across DST", () => {
    expect(berlinCalendarDay("2026-09-30T22:30:00.000Z")).toBe("2026-10-01");
    expect(nextBerlinCalendarDay("2026-03-28T23:30:00.000Z")).toBe("2026-03-30");
    expect(snoozeDueAt("2026-03-30", "2026-03-28T23:30:00.000Z")).toBe("2026-03-30T12:00:00.000Z");
    expect(nextBerlinCalendarDay("2026-10-25T00:30:00.000Z")).toBe("2026-10-26");
  });

  test("rejects today, earlier dates, and invalid calendar dates", () => {
    expect(snoozeDueAt("2026-10-01", "2026-09-30T22:30:00.000Z")).toBeNull();
    expect(snoozeDueAt("2026-09-30", "2026-09-30T22:30:00.000Z")).toBeNull();
    expect(snoozeDueAt("2026-02-30", "2026-01-01T12:00:00.000Z")).toBeNull();
  });
});
