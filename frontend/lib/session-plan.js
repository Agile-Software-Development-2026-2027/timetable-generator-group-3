// KAN-78: the session length is a maximum. The weekly minutes are split
// evenly into the fewest sessions that don't exceed it, like the engine does
// (5 h with a 3-hour maximum is 3 h + 2 h).
// Split in whole hours when the grid allows it, else in whole grid blocks,
// else in whole sessions (same rule as backend/app/engine/facts.py).
function splitUnit(maxMinutes, blockMinutes) {
  if (maxMinutes % 60 === 0 && 60 % blockMinutes === 0) return 60;
  if (maxMinutes % blockMinutes === 0) return blockMinutes;
  return maxMinutes;
}

export function splitWeeklyMinutes(weeklyMinutes, maxMinutes, blockMinutes = 60) {
  if (!(weeklyMinutes > 0) || !(maxMinutes > 0) || !(blockMinutes > 0)) return [];
  const unit = splitUnit(maxMinutes, blockMinutes);
  const totalUnits = Math.ceil(weeklyMinutes / unit);
  const maxUnits = Math.max(1, Math.floor(maxMinutes / unit));
  const count = Math.ceil(totalUnits / maxUnits);
  const base = Math.floor(totalUnits / count);
  const extra = totalUnits % count;
  return Array.from({ length: count }, (_, index) => (base + (index < extra ? 1 : 0)) * unit);
}

export function formatHours(minutes) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}
