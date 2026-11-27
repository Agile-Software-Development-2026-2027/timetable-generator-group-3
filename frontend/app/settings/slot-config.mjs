export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((short, value) => ({ value, short }));

export const emptySlotForm = {
  working_days: [], start_time: "", end_time: "", block_minutes: "", break_start: "", break_end: "",
};

export function slotFormFromConfig(config) {
  return {
    working_days: [...config.working_days].sort((a, b) => a - b),
    start_time: config.start_time.slice(0, 5),
    end_time: config.end_time.slice(0, 5),
    block_minutes: String(config.block_minutes),
    break_start: config.break_start?.slice(0, 5) ?? "",
    break_end: config.break_end?.slice(0, 5) ?? "",
  };
}

// "09:30" -> 570; null unless the whole text is a valid HH:MM time.
export function toMinutes(text) {
  const match = /^(\d{2}):(\d{2})$/.exec(text ?? "");
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function blockLength(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

export function slotFormErrors(form) {
  const errors = {};
  const start = toMinutes(form.start_time);
  const end = toMinutes(form.end_time);
  const block = blockLength(form.block_minutes);
  if (!form.working_days.length) errors.working_days = "Select at least one working day.";
  if (start === null) errors.start_time = "Enter a start time.";
  if (end === null) errors.end_time = "Enter an end time.";
  else if (start !== null && end <= start) errors.end_time = "End time must be after start time.";
  if (block === null || block === 0) errors.block_minutes = "Block length must be a whole number greater than 0.";
  else if (start !== null && end !== null && end > start && end - start < block) {
    errors.block_minutes = "The time range is shorter than one block.";
  }
  // KAN-78: the lunch break is optional; both times or neither.
  const hasBreakStart = Boolean(form.break_start);
  const hasBreakEnd = Boolean(form.break_end);
  if (hasBreakStart !== hasBreakEnd) {
    errors[hasBreakStart ? "break_end" : "break_start"] = "Enter both lunch break times, or leave both empty.";
  } else if (hasBreakStart) {
    const breakStart = toMinutes(form.break_start);
    const breakEnd = toMinutes(form.break_end);
    if (breakStart === null) errors.break_start = "Enter a valid time.";
    else if (breakEnd === null) errors.break_end = "Enter a valid time.";
    else if (breakEnd <= breakStart) errors.break_end = "The lunch break must end after it starts.";
    else if (start !== null && end !== null && (breakStart < start || breakEnd > end)) {
      errors.break_start = "The lunch break must be within the daily schedule.";
    }
  }
  return errors;
}

// KAN-78: every block of the day, flagged when it overlaps the lunch break
// (the engine leaves those blocks out, like backend/app/slot_config.py).
export function dayBlockTimes(form) {
  const start = toMinutes(form.start_time);
  const end = toMinutes(form.end_time);
  const block = Number(form.block_minutes);
  if (start === null || end === null || !(block > 0)) return [];
  const breakStart = toMinutes(form.break_start);
  const breakEnd = toMinutes(form.break_end);
  const hasBreak = breakStart !== null && breakEnd !== null && breakEnd > breakStart;
  const blocks = [];
  for (let cursor = start; cursor + block <= end; cursor += block) {
    blocks.push({ start: cursor, inBreak: hasBreak && cursor < breakEnd && cursor + block > breakStart });
  }
  return blocks;
}

// [0,1,2,3,4] -> "Mon–Fri"; [0,2,4] -> "Mon, Wed, Fri".
// Only runs of three or more days use a dash: two days read better as a list ("Sat, Sun").
export function formatDays(days) {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  if (sorted.length > 2 && contiguous) return `${weekdays[sorted[0]].short}–${weekdays[sorted.at(-1)].short}`;
  return sorted.map((day) => weekdays[day].short).join(", ");
}

export function slotPreview(form) {
  if (Object.keys(slotFormErrors(form)).length) return null;
  const block = Number(form.block_minutes);
  const perDay = dayBlockTimes(form).filter((item) => !item.inBreak).length;
  const days = form.working_days.length;
  const lunch = form.break_start ? ` · lunch ${form.break_start}–${form.break_end}` : "";
  return `${formatDays(form.working_days)} · ${form.start_time}–${form.end_time}${lunch} · ${block} min blocks → `
    + `${perDay} slots/day × ${days} ${days === 1 ? "day" : "days"} = ${perDay * days} total slots`;
}

export function slotPayload(form) {
  return {
    working_days: [...form.working_days].sort((a, b) => a - b),
    start_time: `${form.start_time}:00`,
    end_time: `${form.end_time}:00`,
    block_minutes: Number(form.block_minutes),
    break_start: form.break_start ? `${form.break_start}:00` : null,
    break_end: form.break_end ? `${form.break_end}:00` : null,
  };
}
