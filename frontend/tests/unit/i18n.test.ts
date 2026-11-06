// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { describe, expect, it } from "vitest";
import { _dictionaries, absenceLabel, holidayName, locale, t } from "../../src/lib/i18n";

describe("i18n", () => {
  it("translates with placeholders and falls back to English", () => {
    locale.value = "en";
    expect(t("dashboard.of_target", { target: "8:24" })).toBe("Target 8:24");
    locale.value = "de";
    expect(t("dashboard.of_target", { target: "8:24" })).toBe("Soll 8:24");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
  it("uses plural forms", () => {
    locale.value = "en";
    expect(t("absences.n_days", { count: 1, n: "1" })).toBe("1 day");
    expect(t("absences.n_days", { count: 3, n: "3" })).toBe("3 days");
    locale.value = "de";
    expect(t("absences.n_days", { count: 1, n: "1" })).toBe("1 Tag");
    expect(t("absences.n_days", { count: 0.5, n: "0.5" })).toBe("0.5 Tage");
  });
  it("translates absence types and holiday names", () => {
    locale.value = "de";
    expect(absenceLabel({ key: "vacation", label: "Vacation" })).toBe("Ferien");
    expect(absenceLabel({ key: "custom", label: "Custom" })).toBe("Custom");
    expect(holidayName("Ascension Day")).toBe("Auffahrt");
    expect(holidayName("Unknown Day")).toBe("Unknown Day");
    locale.value = "en";
    expect(holidayName("Ascension Day")).toBe("Ascension Day");
  });
  it("translates French with Swiss-French plural rules", () => {
    locale.value = "fr";
    expect(t("dashboard.of_target", { target: "8:24" })).toBe("Dû 8:24");
    expect(t("absences.n_days", { count: 1, n: "1" })).toBe("1 jour");
    expect(t("absences.n_days", { count: 0, n: "0" })).toBe("0 jour");
    expect(t("absences.n_days", { count: 3, n: "3" })).toBe("3 jours");
    expect(absenceLabel({ key: "vacation", label: "Vacation" })).toBe("Vacances");
    expect(holidayName("Ascension Day")).toBe("Ascension");
    expect(holidayName("Federal Day of Thanksgiving, Repentance and Prayer")).toBe("Jeûne fédéral");
    locale.value = "en";
  });
  it("ships English, German and French", () => {
    expect(Object.keys(_dictionaries).sort()).toEqual(["de", "en", "fr"]);
  });
});
