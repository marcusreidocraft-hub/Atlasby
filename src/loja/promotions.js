export function offerApplies(offer, sku, plan, now) {
  if (!offer || offer.sku !== sku || offer.plan !== plan) return false;
  if (!offer.active || offer.unitsLeft <= 0) return false;
  return offer.startsAt <= now && now < offer.endsAt;
}

export function quotePrice({ product, plan, now, hoursEnabled = true, overrides = {}, offer = null }) {
  if (!product) return null;
  if ((plan === "3h" || plan === "6h") && !hoursEnabled) return null;
  const original = plan === "3h" && overrides.price3h
    ? overrides.price3h
    : plan === "6h" && overrides.price6h
      ? overrides.price6h
      : product.prices?.[plan];
  if (!original) return null;
  if (!offerApplies(offer, product.sku, plan, now)) {
    return { original, discount: 0, total: original, percent: 0, offerId: null };
  }
  const total = Math.max(1, Math.min(original, offer.promoCents));
  const discount = original - total;
  return {
    original,
    discount,
    total,
    percent: Math.round((discount / original) * 100),
    offerId: offer.id,
  };
}

export function rangesOverlap(left, right) {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

export function validateOffer({ original, promo, units, startsAt, endsAt, now, existing = [], sku, plan }) {
  if (!original) return { ok: false, error: "Esse plano não existe nesse produto." };
  if (!Number.isInteger(promo) || promo <= 0 || promo >= original) {
    return { ok: false, error: "O preço promocional precisa ser maior que zero e menor que o original." };
  }
  if (!Number.isInteger(units) || units < 1) return { ok: false, error: "Informe pelo menos uma unidade." };
  if (!startsAt || !endsAt || endsAt <= startsAt || endsAt <= now) {
    return { ok: false, error: "O fim precisa ser depois do início e no futuro." };
  }
  const candidate = { sku, plan, startsAt, endsAt };
  const clash = existing.some((offer) => offer.active && offer.unitsLeft > 0 && offer.sku === sku && offer.plan === plan && rangesOverlap(offer, candidate));
  if (clash) return { ok: false, error: "Já existe uma oferta ativa para este produto e plano nesse período." };
  const discount = original - promo;
  return { ok: true, percent: Math.round((discount / original) * 100), promo };
}

export function priceFromDiscount(original, percent) {
  const promo = Math.round(original * (100 - percent) / 100);
  return Math.max(1, Math.min(original, promo));
}
