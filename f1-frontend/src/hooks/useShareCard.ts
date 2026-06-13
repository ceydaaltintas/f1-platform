import { useRef, useCallback } from 'react'

export function useShareCard() {
  const cardRef = useRef<HTMLDivElement>(null)

  const share = useCallback(async (filename = 'hotlap-analysis') => {
    if (!cardRef.current) return

    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: '#0a0a0a',
      scale: 2,               // retina kalitesi
      useCORS: true,
      logging: false,
    })

    const blob = await new Promise<Blob>((res) =>
      canvas.toBlob((b) => res(b!), 'image/png')
    )

    // Web Share API destekleniyorsa (mobil)
    if (navigator.canShare?.({ files: [new File([blob], `${filename}.png`)] })) {
      await navigator.share({
        title: 'Hotlap Analizi',
        text: 'hotlap.live üzerinde F1 telemetri analizi',
        files: [new File([blob], `${filename}.png`, { type: 'image/png' })],
      })
      return
    }

    // Masaüstü: doğrudan indir
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.png`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return { cardRef, share }
}
