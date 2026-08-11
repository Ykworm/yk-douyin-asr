const DOUYIN_URL_RE =
  /https?:\/\/(?:v\.douyin\.com\/[\w-]+|www\.douyin\.com\/(?:video|note|user)\/[\w/-]+|www\.iesdouyin\.com\/share\/video\/[\w/-]+)/gi;

export function extractDouyinUrl(input: string): string | null {
  const trimmed = input.trim();
  const matches = trimmed.match(DOUYIN_URL_RE);
  if (matches?.[0]) return matches[0].replace(/[，。！？\s]+$/, "");
  return null;
}

export function normalizeShareText(input: string): string {
  const url = extractDouyinUrl(input);
  if (!url) throw new Error("未找到有效的抖音链接，请粘贴分享链接或口令");
  return url;
}
