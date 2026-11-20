export function resourceNames(orderId) {
  const short = String(orderId).replace(/[^a-z0-9]/gi, "").slice(0, 10).toLowerCase() || "pedido";
  return {
    vm: `atlas${short}`.slice(0, 15),
    ip: `atlas-ip-${short}`,
    nic: `atlas-nic-${short}`,
    disk: `atlas-os-${short}`,
  };
}

export async function advanceProvision(state, steps) {
  const next = { ...state, names: state.names || resourceNames(state.orderId) };
  if (next.step === "done") return { state: next, created: false };
  if (!next.quotaOk) {
    const quota = await steps.quota(next);
    if (!quota?.ok) return { state: { ...next, step: "acompanhamento", error: quota?.error || "cota" }, created: false };
    next.quotaOk = true;
  }
  let created = false;
  if (!next.ipId) next.ipId = await steps.ip(next);
  if (!next.nicId) next.nicId = await steps.nic(next);
  if (!next.vmId) {
    next.vmId = await steps.vm(next);
    created = true;
  }
  if (!next.publicIp) next.publicIp = await steps.readIp(next);
  if (!next.healthy) {
    const health = await steps.health(next.publicIp);
    if (!health?.ok) return { state: { ...next, step: "acompanhamento", error: "agente" }, created };
    next.healthy = true;
  }
  next.step = "done";
  next.error = "";
  return { state: next, created };
}
