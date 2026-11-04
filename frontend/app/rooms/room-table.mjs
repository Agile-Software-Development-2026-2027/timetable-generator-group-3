export const pageSizes = [10, 50, 100];
export const defaultSort = { key: "code", direction: "asc" };

// Numeric collation keeps codes in reading order: MT2 comes before MT10.
const codeOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function searchRooms(rooms, query) {
  const text = query.trim().toLowerCase();
  if (!text) return rooms;
  return rooms.filter((room) => room.code.toLowerCase().includes(text));
}

export function sortRooms(rooms, { key, direction }) {
  const sign = direction === "desc" ? -1 : 1;
  return [...rooms].sort((first, second) => {
    const order = key === "code" ? codeOrder.compare(first.code, second.code) : first[key] - second[key];
    return order ? sign * order : codeOrder.compare(first.code, second.code);
  });
}

export function nextSort(sort, key) {
  if (sort.key !== key) return { key, direction: "asc" };
  return { key, direction: sort.direction === "asc" ? "desc" : "asc" };
}

export function paginate(rows, page, pageSize) {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pageCount);
  const start = (current - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  return { rows: pageRows, page: current, pageCount, total, first: total ? start + 1 : 0, last: start + pageRows.length };
}

// The page buttons to draw; null marks a gap of hidden pages.
export function pageNumbers(page, pageCount) {
  const numbers = [];
  for (let number = 1; number <= pageCount; number += 1) {
    if (number === 1 || number === pageCount || Math.abs(number - page) <= 1) numbers.push(number);
  }
  return numbers.flatMap((number, index) => {
    const gap = number - (numbers[index - 1] ?? number);
    if (gap === 2) return [number - 1, number];
    return gap > 2 ? [null, number] : [number];
  });
}
