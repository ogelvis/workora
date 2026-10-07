// Recognising video files, so video uploads can be kept to the plans that include them.

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'qt', 'avi', 'mkv', 'webm', 'wmv', 'asf', 'flv', 'f4v', 'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'ogv', 'mts', 'm2ts', 'vob']

// By name and declared type: what the browser tells us.
export function looksLikeVideo(name = '', type = '') {
  const extension = String(name).toLowerCase().split('.').pop()
  return String(type).toLowerCase().startsWith('video/') || (String(name).includes('.') && VIDEO_EXTENSIONS.includes(extension))
}

// MP4-family files start with "ftyp" and a brand; these brands are pictures or audio, not video.
const NOT_VIDEO_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis', 'M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B ', 'crx ', 'jp2 ']

// By content: the first bytes of the file, which renaming can't change.
export function hasVideoSignature(bytes) {
  if (!bytes || bytes.length < 12) return false
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end))
  if (ascii(4, 8) === 'ftyp') return !NOT_VIDEO_BRANDS.includes(ascii(8, 12))
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true // Matroska / WebM
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'AVI ') return true
  if (ascii(0, 3) === 'FLV') return true
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && (bytes[3] === 0xba || bytes[3] === 0xb3)) return true // MPEG
  if (bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xb2 && bytes[3] === 0x75) return true // Windows Media
  return false
}
