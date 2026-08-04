"use strict";

/**
 * Licence gate wired to Power BI's transactable Licensing API (API ≥ 4.7).
 * FREEMIUM go-paid (CEO 2026-08-04, NG-263): `premium.active === false` gates the
 * 11 enterprise features AND forces the Zentrix watermark on (visual.ts). The base
 * graph always renders — no whole-visual block. (NG-262's hard-trial lock reverted.)
 *
 * Still FAIL-OPEN on the safe paths: an unsupported host/environment, unavailable
 * licence info (signed-out/offline Desktop), or any licence-API error all resolve
 * to ACTIVE. `LOCK_ON_NO_PLAN` is ON now — the AppSource plan (with Microsoft's
 * one-month free trial) MUST be live at go-live or every creator locks out. A
 * published visual cannot be end-to-end license-tested, so the evaluation is a
 * PURE function (`evaluateLicense`) pinned by mocked-API tests; give the reviewer
 * licence info in "Notes for certification".
 *
 * Enforcement posture (CEO decision 2026-07-23): **viewers are free.** Licences
 * are enforced in edit/authoring mode only; Reading view always fail-opens.
 * This is the anti-ZoomCharts wedge (their every-viewer seat + 20-user minimum
 * is the most-resented policy in the category) and mirrors Inforiver's
 * creator-based model.
 *
 * UX: the visual never draws its own licensing UI. When enforcement is on and
 * no usable plan exists, we raise Power BI's predefined notification
 * (`notifyLicenseRequired(General)`); when licensed or fail-open we clear it.
 * The gate never blocks rendering and never throws into update().
 */

import powerbi from "powerbi-visuals-api";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

/** Go-paid master switch — ON (CEO 2026-08-04, NG-263): freemium. Gates the 11
 *  enterprise features + forces the Zentrix watermark while unlicensed; the base
 *  graph stays free forever. Ships enforcing; the paid plan (with the one-month
 *  trial of the premium tier) must be live at go-live. */
const LOCK_ON_NO_PLAN = true;
/** Viewers-free posture: enforce in edit mode only. Leave false unless the CEO
 *  reverses the 2026-07-23 decision to charge report viewers too. */
const ENFORCE_FOR_VIEWERS = false;

/** Only Active and Warning are usable licences (Microsoft: "all other states
 *  should be treated as not resulting in a usable license"). */
const USABLE_STATES = new Set<number>([
    1, // ServicePlanState.Active
    2, // ServicePlanState.Warning (grace period)
]);

export interface LicenseInfoLike {
    plans?: { spIdentifier?: string; state?: number }[];
    isLicenseUnsupportedEnv?: boolean;
    isLicenseInfoAvailable?: boolean;
}

export interface LicenseDecision {
    /** Whether the Enterprise features are offered. */
    active: boolean;
    /** Which predefined host notification to raise ("none" clears any). */
    notify: "none" | "required" | "unsupportedEnv";
}

/**
 * Pure licence evaluation — the entire policy in one testable function.
 * `editing` is true in edit/authoring mode (where viewers-free enforcement bites).
 */
export function evaluateLicense(
    info: LicenseInfoLike | null | undefined,
    opts: { lockOnNoPlan: boolean; enforceForViewers: boolean; editing: boolean },
): LicenseDecision {
    // Master switch off → everything free, no notifications (pre-go-paid state).
    if (!opts.lockOnNoPlan) return { active: true, notify: "none" };
    // Viewers-free: outside edit mode the gate never closes and never nags.
    if (!opts.editing && !opts.enforceForViewers) return { active: true, notify: "none" };
    // No info at all (call failed) → fail open.
    if (!info) return { active: true, notify: "none" };
    // Unsupported environment (Publish-to-web, embed, Report Server, …): licence
    // enforcement cannot work there — fail open, tag the env notification.
    if (info.isLicenseUnsupportedEnv) return { active: true, notify: "unsupportedEnv" };
    // Licence info unavailable (signed-out / offline Desktop) → fail open.
    if (info.isLicenseInfoAvailable === false) return { active: true, notify: "none" };
    const usable = Array.isArray(info.plans)
        && info.plans.some((p) => p && USABLE_STATES.has(p.state ?? -1));
    return usable ? { active: true, notify: "none" } : { active: false, notify: "required" };
}

interface LicenseManagerLike {
    getAvailableServicePlans?: () => Promise<LicenseInfoLike>;
    notifyLicenseRequired?: (type: number) => Promise<boolean>;
    notifyFeatureBlocked?: (tooltip: string) => Promise<boolean>;
    clearLicenseNotification?: () => Promise<boolean>;
}

export class PremiumGate {
    private activeState = true;
    private lastNotified: LicenseDecision["notify"] = "none";

    constructor(private host: IVisualHost, private onResolved: () => void) { }

    /** Whether Enterprise features are unlocked. Fail-open. */
    get active(): boolean {
        return this.activeState;
    }

    /** Transient "this feature needs a licence" banner (freemium, NG-264). Best-effort;
     *  fires only while unlicensed (a licensed / fail-open session is a no-op). Uses Power BI's
     *  predefined `notifyFeatureBlocked` — never our own UI. The caller edge-triggers it so the
     *  10-second banner isn't re-raised on every repaint. */
    blockFeature(tooltip: string): void {
        if (this.activeState) return;
        try {
            const lm = (this.host as unknown as { licenseManager?: LicenseManagerLike }).licenseManager;
            void lm?.notifyFeatureBlocked?.(tooltip);
        } catch { /* cosmetic — never break the gate */ }
    }

    /**
     * Re-check the licence. Best-effort and fully guarded — any failure leaves
     * the gate ACTIVE. `editing` comes from the host's viewMode (edit vs read).
     */
    refresh(editing = false): void {
        // Short-circuit while the go-paid switch is off: no API chatter, no UX.
        if (!LOCK_ON_NO_PLAN) {
            this.activeState = true;
            return;
        }
        try {
            const lm = (this.host as unknown as { licenseManager?: LicenseManagerLike }).licenseManager;
            if (!lm || typeof lm.getAvailableServicePlans !== "function") {
                this.activeState = true; // unsupported host → fail open
                return;
            }
            lm.getAvailableServicePlans()
                .then((info) => {
                    const d = evaluateLicense(info, {
                        lockOnNoPlan: LOCK_ON_NO_PLAN,
                        enforceForViewers: ENFORCE_FOR_VIEWERS,
                        editing,
                    });
                    this.activeState = d.active;
                    this.applyNotification(lm, d.notify);
                    this.onResolved();
                })
                .catch(() => { this.activeState = true; }); // API error → fail open
        } catch {
            this.activeState = true;
        }
    }

    /** Raise/clear the PREDEFINED host notification (never our own UI). */
    private applyNotification(lm: LicenseManagerLike, notify: LicenseDecision["notify"]): void {
        if (notify === this.lastNotified) return;
        this.lastNotified = notify;
        try {
            if (notify === "required") void lm.notifyLicenseRequired?.(0);        // General
            else if (notify === "unsupportedEnv") void lm.notifyLicenseRequired?.(1); // UnsupportedEnv
            else void lm.clearLicenseNotification?.();
        } catch { /* notification is cosmetic — never let it break the gate */ }
    }
}
