/**
 * Tournament setup helpers for the admin draw-entry experience.
 *
 * Everything here is pure, framework-agnostic, and reuses the existing group
 * sizing and draw-order assignment logic from `groups.ts`. Nothing randomizes
 * the draw — the physical draw happens outside the app and the administrator
 * only records the result.
 *
 * These helpers exist so the React admin UI can stay free of tournament logic:
 * the UI calls `validateSetupInput` + `buildSetup` and only renders the result.
 */

import { getGroupIndexForDrawOrder, getGroupSizes } from "./groups.ts";

// ---------------------------------------------------------------------------
// Draw slots and group labels
// ---------------------------------------------------------------------------

/** A single slot in the manual draw: a draw position and its assigned group. */
export interface DrawSlot {
  /** 1-based position in the manual participant draw. */
  drawOrder: number;
  /** 0-based group index derived from the draw order. */
  groupIndex: number;
  /** Human-readable group label, e.g. "A", "B", ... */
  groupLabel: string;
}

/**
 * Maps a 0-based group index to a label: 0 → "A", 25 → "Z", 26 → "AA", etc.
 *
 * This keeps group labels deterministic and not limited to A–Z, so unusually
 * large group counts (e.g. 32+ groups) still render a unique label.
 */
export function getGroupLabel(index: number): string {
  if (!Number.isInteger(index)) {
    throw new Error(`group index must be an integer (got ${index}).`);
  }
  if (index < 0) {
    throw new Error(`group index must be non-negative (got ${index}).`);
  }

  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

// ---------------------------------------------------------------------------
// Setup plan
// ---------------------------------------------------------------------------

/** Result of generating a tournament setup: group sizes + one slot per draw. */
export interface SetupPlan {
  participantCount: number;
  groupCount: number;
  /** Group sizes from `getGroupSizes`, larger groups first when uneven. */
  groupSizes: number[];
  /** One slot per participant, ordered by draw position (1..participantCount). */
  slots: DrawSlot[];
}

/**
 * Builds a complete setup plan from the chosen participant and group counts.
 *
 * Reuses `getGroupSizes` for the balanced group distribution and
 * `getGroupIndexForDrawOrder` for each slot's group assignment. The returned
 * `slots` array is ordered by draw order so the UI can render them directly
 * without recomputing any group-assignment logic.
 *
 * Throws the same errors as `getGroupSizes` for invalid inputs; callers that
 * need friendly messages should pre-validate with `validateSetupInput`.
 */
export function buildSetup(
  participantCount: number,
  groupCount: number,
): SetupPlan {
  const groupSizes = getGroupSizes(participantCount, groupCount);

  const slots: DrawSlot[] = [];
  for (let drawOrder = 1; drawOrder <= participantCount; drawOrder++) {
    const groupIndex = getGroupIndexForDrawOrder(drawOrder, groupSizes);
    slots.push({
      drawOrder,
      groupIndex,
      groupLabel: getGroupLabel(groupIndex),
    });
  }

  return { participantCount, groupCount, groupSizes, slots };
}

// ---------------------------------------------------------------------------
// Input validation (boundary layer)
// ---------------------------------------------------------------------------

export type SetupValidationResult =
  | { ok: true; participantCount: number; groupCount: number }
  | { ok: false; message: string };

/**
 * Validates raw (string) setup input from the admin form and converts domain
 * constraints into friendly, user-facing messages. Never exposes raw domain
 * exceptions to the UI.
 *
 * Handles: empty values, non-numeric/decimal values, zero, negative values,
 * and "more groups than participants".
 */
export function validateSetupInput(
  participantCountRaw: string,
  groupCountRaw: string,
): SetupValidationResult {
  const participantTrimmed = participantCountRaw.trim();
  const groupTrimmed = groupCountRaw.trim();

  if (participantTrimmed === "") {
    return { ok: false, message: "Enter the number of participants." };
  }
  if (groupTrimmed === "") {
    return { ok: false, message: "Enter the number of groups." };
  }

  const participantCount = Number(participantTrimmed);
  const groupCount = Number(groupTrimmed);

  if (!Number.isInteger(participantCount)) {
    return {
      ok: false,
      message: "Participant count must be a whole number.",
    };
  }
  if (!Number.isInteger(groupCount)) {
    return { ok: false, message: "Group count must be a whole number." };
  }

  if (participantCount <= 0) {
    return {
      ok: false,
      message: "Participant count must be at least 1.",
    };
  }
  if (groupCount <= 0) {
    return { ok: false, message: "Group count must be at least 1." };
  }

  if (groupCount > participantCount) {
    return {
      ok: false,
      message: "The number of groups cannot exceed the number of participants.",
    };
  }

  return { ok: true, participantCount, groupCount };
}