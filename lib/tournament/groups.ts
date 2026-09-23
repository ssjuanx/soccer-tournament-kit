/**
 * Group distribution and draw-order group assignment.
 *
 * The physical draw happens outside the app. The app only assigns the next draw
 * slot to the correct group based on the configured group sizes. Nothing here
 * randomizes anything.
 */

// ---------------------------------------------------------------------------

/**
 * Distributes `participantCount` participants across `groupCount` groups as
 * evenly as possible, with larger groups placed first when the division is
 * uneven.
 *
 * Examples:
 *   getGroupSizes(8, 2)  // [4, 4]
 *   getGroupSizes(13, 4) // [4, 3, 3, 3]
 *   getGroupSizes(14, 4) // [4, 4, 3, 3]
 *   getGroupSizes(15, 4) // [4, 4, 4, 3]
 *   getGroupSizes(16, 4) // [4, 4, 4, 4]
 *   getGroupSizes(64, 8) // [8, 8, 8, 8, 8, 8, 8, 8]
 *
 * Throws on invalid inputs (non-integer, non-positive, or more groups than
 * participants, which would create empty groups).
 */
export function getGroupSizes(
  participantCount: number,
  groupCount: number,
): number[] {
  if (!Number.isInteger(participantCount)) {
    throw new Error(`participantCount must be an integer (got ${participantCount}).`);
  }
  if (!Number.isInteger(groupCount)) {
    throw new Error(`groupCount must be an integer (got ${groupCount}).`);
  }
  if (participantCount <= 0) {
    throw new Error(`participantCount must be positive (got ${participantCount}).`);
  }
  if (groupCount <= 0) {
    throw new Error(`groupCount must be positive (got ${groupCount}).`);
  }
  if (groupCount > participantCount) {
    throw new Error(
      `groupCount (${groupCount}) cannot exceed participantCount (${participantCount}).`,
    );
  }

  const base = Math.floor(participantCount / groupCount);
  const remainder = participantCount % groupCount;
  const sizes: number[] = [];
  for (let i = 0; i < groupCount; i++) {
    // The first `remainder` groups get one extra participant so that larger
    // groups come first when the split is uneven.
    sizes.push(i < remainder ? base + 1 : base);
  }
  return sizes;
}

/**
 * Maps a 1-based draw position to a 0-based group index, given the group sizes
 * produced by `getGroupSizes`.
 *
 * Example for 14 participants and group sizes [4, 4, 3, 3]:
 *   draw 1–4  -> group 0
 *   draw 5–8  -> group 1
 *   draw 9–11 -> group 2
 *   draw 12–14-> group 3
 *
 * This is deterministic and never randomizes — the physical draw order is
 * entered by the administrator and only the slot-to-group mapping is computed.
 */
export function getGroupIndexForDrawOrder(
  drawOrder: number,
  groupSizes: number[],
): number {
  if (!Number.isInteger(drawOrder)) {
    throw new Error(`drawOrder must be an integer (got ${drawOrder}).`);
  }
  if (drawOrder < 1) {
    throw new Error(`drawOrder must be at least 1 (got ${drawOrder}).`);
  }
  if (groupSizes.length === 0) {
    throw new Error("groupSizes must contain at least one group.");
  }

  let cumulative = 0;
  for (let index = 0; index < groupSizes.length; index++) {
    const size = groupSizes[index];
    if (!Number.isInteger(size) || size < 0) {
      throw new Error(`groupSizes contains an invalid size (got ${size} at index ${index}).`);
    }
    cumulative += size;
    if (drawOrder <= cumulative) {
      return index;
    }
  }

  const total = groupSizes.reduce((sum, size) => sum + size, 0);
  throw new Error(
    `drawOrder ${drawOrder} is out of range for ${total} total slots.`,
  );
}