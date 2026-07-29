"use strict";

/**
 * Single source of truth for the user-visible build version.
 *
 * KEEP IN SYNC with pbiviz.json (visual.version + top-level "version") and
 * package.json on every release bump — part of the version-bump checklist.
 * Stays 1.0.0.0 until AppSource publication (CEO rule).
 */
export const VERSION = "1.0.0.0";
