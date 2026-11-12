export const STORE_EMOJI = Object.freeze({
  monitor: { id: "1568512326804574281", name: "monitor" },
  rdp: { id: "1568512345825878049", name: "rdp" },
  gaming: { id: "1568512664705961985", name: "8688gaming" },
  boost: { id: "1568512687363719188", name: "boost" },
  booster: { id: "1545310538891005993", name: "Booster" },
  windows: { id: "1568627841954873366", name: "windows" },
  tools: { id: "1568512989924171796", name: "tools" },
  cash: { id: "1568512689754349651", name: "cash" },
  timer: { id: "1568512986484711425", name: "timer" },
  cart: { id: "1537131907777695895", name: "carrinho" },
  shopping: { id: "1568512983192051712", name: "shoppingcart" },
  megaphone: { id: "1568512322450882665", name: "megaphone" },
  star: { id: "1568512980033863820", name: "star" },
  off: { id: "1568512700739362897", name: "disactiv" },
  warning: { id: "1568512629847101531", name: "5577warning" },
  arrow: { id: "1568512590789869609", name: "12560blackarrow" },
  ticket: { id: "1568512619722309644", name: "49457ticket" },
  staff: { id: "1568512667415609406", name: "91750staff" },
  admin: { id: "1568512661334003762", name: "8011admin" },
  verified: { id: "1568512623639797863", name: "53136verified" },
  bell: { id: "1568512976737013790", name: "bell" },
  mail: { id: "1568512319489708042", name: "mail" },
  announcement: { id: "1568512594044784724", name: "1701announcement" },
  vip: { id: "1568512612625424487", name: "44216vip" },
  link: { id: "1568512657458470964", name: "7957link" },
  settings: { id: "1568512697002098728", name: "dgear" },
});

export function emojiText(key) {
  const emoji = STORE_EMOJI[key];
  return emoji ? `<:${emoji.name}:${emoji.id}>` : "";
}

export function machineEmoji(vcpus) {
  if (vcpus >= 16) return "booster";
  if (vcpus >= 8) return "boost";
  return "gaming";
}
