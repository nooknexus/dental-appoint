export function formatStartingPrice(priceLabel: string) {
  const match = priceLabel.match(/^([\d,]+)(?:–[\d,]+)?\s*บาท$/);

  return match ? `เริ่มต้นที่ ${match[1]} บาท` : priceLabel;
}
