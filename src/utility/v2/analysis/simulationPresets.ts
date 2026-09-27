/**
 * SIMULATION PRESETS — a complete run configuration, named and reloadable.
 *
 * =====================================================================
 * WHY THIS IS A MODULE AND NOT A HANDFUL OF localStorage KEYS
 * =====================================================================
 * Every setting in the lab already persists individually, which is fine for
 * "keep what I had last time" and useless for "put it back the way it was for
 * the control run". Comparing two runs means setting thirty-odd fields by hand
 * and being sure none was missed — and a single missed field silently makes the
 * two runs incomparable, which is a failure that looks exactly like a result.
 *
 * So a preset is the WHOLE configuration or nothing. There is no partial apply.
 *
 * =====================================================================
 * THE FAILURE THIS IS BUILT TO AVOID
 * =====================================================================
 * The obvious future bug is adding a setting and forgetting to add it here:
 * presets would then quietly apply a stale value for it while appearing to
 * restore everything. Two things stop that.
 *
 *   1. `SimulationSettings` has NO optional fields. The component builds its
 *      ref table as `RefsFor<SimulationSettings>`, so a new setting that is not
 *      in this interface fails to typecheck at the table, and one that IS in the
 *      interface but has no ref fails there too. Missing either way is a compile
 *      error, not a silent stale value.
 *   2. `validateSettings` reports every field a stored preset did not carry,
 *      rather than filling it in quietly. A preset saved before a setting
 *      existed is a real and ordinary case; it just has to be visible.
 *
 * =====================================================================
 * WHAT A PRESET DELIBERATELY DOES AND DOES NOT CARRY
 * =====================================================================
 * IT CARRIES THE DATE RANGE. A configuration without its window is not
 * reproducible: the same settings over 2026-01-01 -> 02-06 and over an
 * open-ended run are not the same experiment, and every measured number in this
 * project is attached to a window. The built-in presets pin the window their
 * numbers came from.
 *
 * IT DOES NOT CARRY THE AUTO-CLOSE RULES. They are a variable-length list with
 * their own editor and their own semantics, and folding them in would mean a
 * preset could silently delete rules the user had set up. They stay under their
 * own control.
 *
 * Pure functions over plain data, no app types and no Vue, so this can be run
 * against a parsed export exactly as simulationSummary.ts and fundingCost.ts are.
 */

/**
 * Every field that defines a run.
 *
 * NO OPTIONAL FIELDS, on purpose — see the note above. Adding one here without
 * adding its ref in the component is a compile error, which is the whole point.
 */
export interface SimulationSettings {
    /** `datetime-local` strings, as the inputs hold them. Empty = unset. */
    startDateTime: string;
    endDateTime: string;

    startingBalance: number;
    margin: number;
    useDynamicMargin: boolean;
    marginStepBalance: number;
    marginStepAmount: number;
    marginFloor: number;
    marginCeiling: number;

    positionCapRatio: number;
    positionCapFloor: number;
    positionCapCeiling: number;

    maxPositionDurationCandles: number;
    minRewardRisk: number;
    minRiskPercent: number;
    allowLong: boolean;
    allowShort: boolean;

    allowReversalEntry: boolean;
    allowExtensionEntry: boolean;
    extensionRr3: boolean;

    breakoutFadeEnabled: boolean;
    breakoutFadeAllowLong: boolean;
    breakoutFadeAllowShort: boolean;
    breakoutFadeMinAtrPercent: number;
    breakoutFadeMinRelVolume: number;
    breakoutFadeMaxFeeRisk: number;

    directionBalanceEnabled: boolean;
    directionBalanceTolerance: number;
    directionBalanceMaxPerDay: number;
    directionBalanceFraction: number;

    crossSectionEnabled: boolean;
    crossSectionLookback: number;
    crossSectionHold: number;
    crossSectionFraction: number;
    crossSectionStopAtr: number;
    crossSectionRiskFraction: number;
    crossSectionMaxLeverage: number;

    initConcurrency: number;
    yieldEverySymbols: number;
}

export type SettingKey = keyof SimulationSettings;

export interface SimulationPreset {
    name: string;
    /** One line on what this configuration is for. Shown beside the dropdown. */
    description: string;
    settings: SimulationSettings;
    /** Built-ins cannot be overwritten or deleted from the UI. */
    builtIn: boolean;
    /** ms epoch; 0 for built-ins. */
    savedAt: number;
}

/**
 * The historical configuration, so an old export can still be reproduced.
 *
 * This is what the lab did before 2026-09-27, including the parts now known to
 * be wrong: long only, the segment entry on, no direction balance. It is here to
 * be compared AGAINST, not to be run in the hope of a different answer.
 */
const HISTORICAL: SimulationSettings = {
    startDateTime: "2026-01-01T00:00",
    endDateTime: "2026-02-28T00:00",
    startingBalance: 200,
    margin: 1,
    useDynamicMargin: true,
    marginStepBalance: 100,
    marginStepAmount: 1,
    marginFloor: 1,
    marginCeiling: 50,
    positionCapRatio: 0.4,
    positionCapFloor: 3,
    positionCapCeiling: 100,
    maxPositionDurationCandles: 250,
    minRewardRisk: 3,
    minRiskPercent: 0,
    allowLong: true,
    allowShort: false,
    allowReversalEntry: true,
    allowExtensionEntry: true,
    extensionRr3: false,
    breakoutFadeEnabled: false,
    breakoutFadeAllowLong: true,
    breakoutFadeAllowShort: true,
    breakoutFadeMinAtrPercent: 0.012,
    breakoutFadeMinRelVolume: 2.5,
    breakoutFadeMaxFeeRisk: 0.25,
    directionBalanceEnabled: false,
    directionBalanceTolerance: 4,
    directionBalanceMaxPerDay: 0,
    directionBalanceFraction: 0.2,
    crossSectionEnabled: false,
    crossSectionLookback: 96,
    crossSectionHold: 384,
    crossSectionFraction: 0.10,
    crossSectionStopAtr: 30,
    crossSectionRiskFraction: 0.5,
    crossSectionMaxLeverage: 20,
    initConcurrency: 6,
    yieldEverySymbols: 120,
};

/**
 * The control run: the breakout-fade entry, balanced, both sides.
 *
 * Expected result is about -0.0117R per trade — near flat and NOT profitable.
 * That is the point of running it. A result near -0.18R instead means the
 * direction-balance rule is not biting, which is a wiring problem rather than a
 * market one, and is worth knowing before anything else is measured.
 *
 * The window is pinned to the one the archive covers, so the run can be compared
 * against the offline numbers directly.
 */
const CONTROL: SimulationSettings = {
    ...HISTORICAL,
    endDateTime: "2026-02-06T00:00",
    allowShort: true,                 // the balance needs both sides
    allowReversalEntry: false,
    allowExtensionEntry: false,
    breakoutFadeEnabled: true,
    directionBalanceEnabled: true,
    // The global R:R gate does not reach this entry - its config has no such
    // field - so 3 here is harmless and left alone rather than set to a number
    // that would only be meaningful for the entries that are off.
    positionCapRatio: 0.20,
    positionCapCeiling: 50,
};

/**
 * The cross-sectional book. The one configuration with a measured signal, and
 * still a hypothesis.
 *
 * THE CAP IS THE PART THAT MATTERS. A decile of ~290 eligible symbols is ~58
 * legs. At ratio 0.20 with 200 equity and margin 1 the cap is 40, so only 20 of
 * the 29 pairs fit and the book is two-thirds of the one that was measured.
 * 0.35 gives 70. The book stays balanced when the cap binds - it opens in pairs -
 * so a truncated run is still a valid measurement, just a smaller one.
 *
 * Every per-symbol entry is off because one position per symbol is the lab's
 * invariant: an entry that takes a symbol first takes it out of the book.
 */
const CROSS_SECTIONAL: SimulationSettings = {
    ...HISTORICAL,
    endDateTime: "2026-02-06T00:00",
    allowShort: true,                 // required; the balance is the mechanism
    allowReversalEntry: false,
    allowExtensionEntry: false,
    breakoutFadeEnabled: false,
    directionBalanceEnabled: false,   // the book is balanced by construction
    crossSectionEnabled: true,
    positionCapRatio: 0.35,
    positionCapCeiling: 80,
};

export const BUILT_IN_PRESETS: readonly SimulationPreset[] = [
    {
        name: "Control — breakout fade, balanced",
        description: "Run A. Both sides, direction-balanced. Expect ≈ −0.0117R per trade: near flat, not profitable. A result near −0.18R means the balance rule is not biting.",
        settings: CONTROL, builtIn: true, savedAt: 0,
    },
    {
        name: "Cross-sectional book",
        description: "Run B. Market-neutral ranked book, 4-day hold, 30-ATR stop, leverage derived from a 0.5 risk budget. Cap raised to fit ~58 legs. The only configuration with a measured signal, and still a hypothesis.",
        settings: CROSS_SECTIONAL, builtIn: true, savedAt: 0,
    },
    {
        name: "Historical (pre-2026-09-27)",
        description: "What the lab did before the archive research: long only, segment entry on, no balance. Here to be compared against, not to be rerun hopefully.",
        settings: HISTORICAL, builtIn: true, savedAt: 0,
    },
];

/** The base a stored preset's missing fields are filled from. */
export const SETTINGS_BASE: SimulationSettings = HISTORICAL;

export interface ValidationResult {
    settings: SimulationSettings;
    /** Keys the stored object did not carry at all. */
    missing: SettingKey[];
    /** Keys it carried with the wrong type, or a non-finite number. */
    invalid: SettingKey[];
}

/**
 * Coerce an unknown object into settings, reporting what it could not take.
 *
 * REPORTS RATHER THAN THROWS. A preset saved before a setting existed is an
 * ordinary case, not corruption, and refusing to load it would lose the rest of
 * a configuration over one field. But filling it in silently is how a run ends
 * up with a value nobody chose, so every substitution is named and the caller
 * shows them.
 *
 * NaN and Infinity count as invalid: a number input can produce NaN from an
 * empty field, and a NaN threshold compares false against everything, which
 * disables a gate rather than tightening it.
 */
export function validateSettings(raw: unknown): ValidationResult {
    const base = SETTINGS_BASE;
    const out = { ...base };
    const missing: SettingKey[] = [];
    const invalid: SettingKey[] = [];
    const obj = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};

    for (const key of Object.keys(base) as SettingKey[]) {
        if (!(key in obj)) { missing.push(key); continue; }
        const want = typeof base[key];
        const got = obj[key];
        if (typeof got !== want) { invalid.push(key); continue; }
        if (want === "number" && !Number.isFinite(got as number)) { invalid.push(key); continue; }
        (out as Record<string, unknown>)[key] = got;
    }
    return { settings: out, missing, invalid };
}

/** Fields where `a` and `b` differ, for showing "modified from <preset>". */
export function diffSettings(a: SimulationSettings, b: SimulationSettings): SettingKey[] {
    return (Object.keys(SETTINGS_BASE) as SettingKey[]).filter(k => a[k] !== b[k]);
}

/**
 * Parse the stored preset list.
 *
 * Anything unreadable yields an EMPTY list rather than throwing: a corrupt
 * localStorage value must not stop the lab from loading. Individual entries that
 * cannot be read are dropped and counted, so the count can be shown instead of
 * the user silently losing a preset without knowing.
 */
export function parseUserPresets(json: string | null): { presets: SimulationPreset[]; dropped: number } {
    if (!json) return { presets: [], dropped: 0 };
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return { presets: [], dropped: 0 }; }
    if (!Array.isArray(parsed)) return { presets: [], dropped: 0 };

    const presets: SimulationPreset[] = [];
    let dropped = 0;
    for (const entry of parsed) {
        if (!entry || typeof entry !== "object") { dropped++; continue; }
        const e = entry as Record<string, unknown>;
        const name = typeof e.name === "string" ? e.name.trim() : "";
        if (!name) { dropped++; continue; }
        const { settings } = validateSettings(e.settings);
        presets.push({
            name,
            description: typeof e.description === "string" ? e.description : "",
            settings,
            builtIn: false,
            savedAt: typeof e.savedAt === "number" && Number.isFinite(e.savedAt) ? e.savedAt : 0,
        });
    }
    return { presets, dropped };
}

export function serializeUserPresets(presets: readonly SimulationPreset[]): string {
    return JSON.stringify(presets.filter(p => !p.builtIn).map(p => ({
        name: p.name, description: p.description, settings: p.settings, savedAt: p.savedAt,
    })));
}

/**
 * Add or replace a user preset by name.
 *
 * REPLACES rather than duplicating, because two presets with one name is a trap:
 * the dropdown shows both and only one of them is ever selectable. Returns a new
 * array; the caller decides whether a replacement needed confirming.
 *
 * A name colliding with a built-in is REFUSED, not shadowed — shadowing would
 * mean "Control" silently stopped being the control.
 */
export function upsertUserPreset(
    presets: readonly SimulationPreset[],
    name: string,
    settings: SimulationSettings,
    savedAt: number,
    description = ""
): { presets: SimulationPreset[]; error: string } {
    const clean = name.trim();
    if (!clean) return { presets: [...presets], error: "A preset needs a name." };
    if (BUILT_IN_PRESETS.some(p => p.name.toLowerCase() === clean.toLowerCase())) {
        return { presets: [...presets], error: `"${clean}" is a built-in preset; choose another name.` };
    }
    const next = presets.filter(p => p.builtIn || p.name.toLowerCase() !== clean.toLowerCase());
    next.push({ name: clean, description, settings: { ...settings }, builtIn: false, savedAt });
    return { presets: next, error: "" };
}

export function removeUserPreset(
    presets: readonly SimulationPreset[],
    name: string
): SimulationPreset[] {
    return presets.filter(p => p.builtIn || p.name !== name);
}