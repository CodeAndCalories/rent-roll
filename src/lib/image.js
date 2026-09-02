// Browser-only image helper. Downscales a picked file to a JPEG data URL
// small enough to live in localStorage. The original file is never stored.

export const PHOTO_MAX_WIDTH = 1200
export const PHOTO_QUALITY = 0.82

/**
 * Resize an image File to at most `maxWidth` px wide (never upscales) and
 * re-encode it as JPEG. Resolves { dataUrl, w, h, bytes, originalW, originalH }.
 * Rejects if the file is not a decodable image.
 */
export async function resizeImageFile(file, maxWidth = PHOTO_MAX_WIDTH, quality = PHOTO_QUALITY) {
  if (!file || !/^image\//.test(file.type || '')) {
    throw new Error('that file is not an image')
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const sw = img.naturalWidth || img.width
    const sh = img.naturalHeight || img.height
    if (!sw || !sh) throw new Error('image has no size')

    const scale = Math.min(1, maxWidth / sw)
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas is unavailable')
    ctx.drawImage(img, 0, 0, w, h)

    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (!dataUrl.startsWith('data:image/')) throw new Error('could not encode the image')

    return { dataUrl, w, h, bytes: dataUrl.length, originalW: sw, originalH: sh }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not decode the image'))
    img.src = url
  })
}
