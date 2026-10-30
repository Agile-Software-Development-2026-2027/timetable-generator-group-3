export const featureFlags = [
  { key: "has_projector", label: "Projector" },
  { key: "has_computers", label: "Computers" },
  { key: "is_lab", label: "Lab / PC room" },
];

export const emptyRoomForm = { code: "", capacity: "", has_projector: false, has_computers: false, is_lab: false };

export function capacityError(value) {
  const text = String(value ?? "").trim();
  if (!/^[+-]?\d+$/.test(text)) return "Capacity must be a whole number.";
  if (Number(text) <= 0) return "Capacity must be greater than zero.";
  return "";
}

export function roomFormErrors(form) {
  const errors = {};
  if (!form.code.trim()) errors.code = "Room code is required.";
  const capacity = capacityError(form.capacity);
  if (capacity) errors.capacity = capacity;
  return errors;
}

export function roomPayload(form) {
  return {
    code: form.code.trim(),
    capacity: Number(String(form.capacity).trim()),
    has_projector: form.has_projector,
    has_computers: form.has_computers,
    is_lab: form.is_lab,
  };
}

export function roomFormFromRoom(room) {
  return {
    code: room.code,
    capacity: String(room.capacity),
    has_projector: room.has_projector,
    has_computers: room.has_computers,
    is_lab: room.is_lab,
  };
}

export function roomsPath(filters) {
  const query = featureFlags.filter(({ key }) => filters[key]).map(({ key }) => `${key}=true`).join("&");
  return query ? `/rooms?${query}` : "/rooms";
}

export function roomFeatures(room) {
  return featureFlags.filter(({ key }) => room[key]).map(({ label }) => label);
}
