/**
 * OOTP's exported pitcher-assignment codes.
 *
 * Deliberately small: these codes state only the current basic starter/reliever
 * assignment used by roster operations. They do not evaluate repertoire,
 * quality, readiness, or a player's best role; Player Development owns that.
 */
export const OOTP_ROLE_STARTER = 11;
export const OOTP_ROLE_RELIEVER = 12;
export const OOTP_ROLE_CLOSER = 13;

export type NormalizedPitchingRole = 'starting_pitcher' | 'relief_pitcher';

/** A basic pitching role, only when both position and role are exported. */
export function normalizedPitchingRole(
  position: number | null,
  role: number | null
): NormalizedPitchingRole | null {
  if (position !== 1) return null;
  if (role === OOTP_ROLE_STARTER) return 'starting_pitcher';
  if (role === OOTP_ROLE_RELIEVER || role === OOTP_ROLE_CLOSER) return 'relief_pitcher';
  return null;
}
