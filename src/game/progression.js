// src/game/progression.js
// Pure progression math (no I/O).

export const XP_PER_LEVEL_UNIT = 140; // tune progression speed

export function xpForLevel(level) {
  const L = Math.max(1, Math.trunc(Number(level) || 1));
  // Total XP required to be at level L (level 1 requires 0 XP).
  return XP_PER_LEVEL_UNIT * Math.pow(L - 1, 2);
}

export function levelFromXp(xp) {
  const x = Math.max(0, Math.trunc(Number(xp) || 0));
  return Math.floor(Math.sqrt(x / XP_PER_LEVEL_UNIT)) + 1;
}

export function xpToNextLevel(xp) {
  const x = Math.max(0, Math.trunc(Number(xp) || 0));
  const level = levelFromXp(x);
  const next = xpForLevel(level + 1);
  return Math.max(0, next - x);
}

export function progressToNextLevel(xp) {
  const x = Math.max(0, Math.trunc(Number(xp) || 0));
  const level = levelFromXp(x);
  const curFloor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = Math.max(1, next - curFloor);
  const into = Math.max(0, x - curFloor);
  const pct = Math.max(0, Math.min(1, into / span));
  return { level, curFloor, next, span, into, pct };
}

