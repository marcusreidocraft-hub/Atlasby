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

export function priceFromDiscount(original, percent) {
  const promo = Math.round(original * (100 - percent) / 100);
  return Math.max(1, Math.min(original, promo));
}
