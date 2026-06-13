export const SEO_BASE = {
  siteName: 'Hotlap',
  baseUrl: 'https://hotlap.live',
  defaultTitle: 'Hotlap — F1 Telemetri ve Canlı Yarış Platformu',
  defaultDescription: 'Formula 1 telemetri verilerini Türkçe AI yorumuyla analiz et. Canlı yarış takibi, sektör analizi, strateji simülatörü.',
  twitterHandle: '@hotlapapp',
}

export function buildPageSEO(opts: {
  title?: string
  description?: string
  path?: string
  imageUrl?: string
}) {
  const title = opts.title ? `${opts.title} · Hotlap` : SEO_BASE.defaultTitle
  const description = opts.description ?? SEO_BASE.defaultDescription
  const url = `${SEO_BASE.baseUrl}${opts.path ?? ''}`
  return { title, description, url }
}
