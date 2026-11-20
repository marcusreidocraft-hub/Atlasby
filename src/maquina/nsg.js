export function samePlace(left, right) {
  return String(left ?? "").toLowerCase().replace(/\s+/g, "") === String(right ?? "").toLowerCase().replace(/\s+/g, "");
}

export function chooseNsgs(list, { location, resourceGroup, limit = 23 } = {}) {
  const regional = (list || []).filter((item) => samePlace(item.location, location));
  const pool = regional.length > limit
    ? regional.filter((item) => item.group === resourceGroup)
    : regional;
  return pool.slice(0, limit);
}

export function atlasNsgRules(agentPort = 7474) {
  const pin = String(agentPort || 7474);
  return [
    {
      name: "moonlight-tcp",
      protocol: "Tcp",
      direction: "Inbound",
      access: "Allow",
      priority: 100,
      sourceAddressPrefix: "*",
      sourcePortRange: "*",
      destinationAddressPrefix: "*",
      destinationPortRanges: ["47984", "47989", "48010"],
    },
    {
      name: "moonlight-udp",
      protocol: "Udp",
      direction: "Inbound",
      access: "Allow",
      priority: 110,
      sourceAddressPrefix: "*",
      sourcePortRange: "*",
      destinationAddressPrefix: "*",
      destinationPortRanges: ["47998-48000", "48002", "48010"],
    },
    {
      name: "rdp",
      protocol: "Tcp",
      direction: "Inbound",
      access: "Allow",
      priority: 120,
      sourceAddressPrefix: "*",
      sourcePortRange: "*",
      destinationAddressPrefix: "*",
      destinationPortRange: "3389",
    },
    {
      name: "agente-pin",
      protocol: "Tcp",
      direction: "Inbound",
      access: "Allow",
      priority: 130,
      sourceAddressPrefix: "*",
      sourcePortRange: "*",
      destinationAddressPrefix: "*",
      destinationPortRange: pin,
    },
  ];
}

export function nsgOptions({ nsgs = [], defaultName = "" } = {}) {
  const options = [];
  if (defaultName) options.push({ label: "Padrão", value: "padrao", description: defaultName.slice(0, 100) });
  options.push({ label: "Criar NSG Atlas", value: "criar", description: "Moonlight, RDP e o agente de PIN" });
  for (const [index, nsg] of nsgs.entries()) {
    options.push({
      label: String(nsg.name || "NSG").slice(0, 100),
      value: `i:${index}`,
      description: String(nsg.group || "grupo").slice(0, 100),
    });
  }
  return options.slice(0, 25);
}
