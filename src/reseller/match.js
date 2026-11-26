import { normalizeVmId, vmNameKey, vmParts } from "../services/vm-link.js";

export function assignmentFor(vm, assignments) {
  const id = normalizeVmId(vm?.id);
  const key = vmNameKey(vm?.name, vm?.resourceGroup);
  return assignments.find((item) => {
    const parts = vmParts(item.infraId);
    return Boolean((id && parts?.id === id) || (key && parts?.key === key && key !== "/"));
  }) || null;
}
