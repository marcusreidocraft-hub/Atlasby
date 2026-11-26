export function freeCores(row) {
  if (!row || !Number.isFinite(row.limit) || !Number.isFinite(row.used)) return null;
  return row.limit - row.used;
}

export function fitsPlan(vcpus, spot, capacity) {
  if (!capacity?.ok) return false;
  const needed = Number(vcpus) || 0;
  if (needed <= 0) return false;
  if (spot !== false) {
    const low = freeCores(capacity.low);
    return low != null && low >= needed;
  }
  const family = freeCores(capacity.family);
  const cores = freeCores(capacity.cores);
  return family != null && cores != null && family >= needed && cores >= needed;
}
