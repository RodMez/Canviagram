// Extrae la composición REAL de los SVG wrapper de marca renderizándolos
// con sharp (los SVG contienen múltiples <image> por capas; extraer el primer
// PNG solo daba una capa parcial). Recorta padding transparente con trim()
// y exporta WebP/AVIF + PNG en public/brand/.
// Uso: node scripts/extract-brand-png.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'Canviagram Isotipo+Logo')
const outDir = join(root, 'public', 'brand')
mkdirSync(outDir, { recursive: true })

// Solo L1-L5 se sirven en la web. L6/L7 (descripcion encima) quedan como reserva.
const MAP = {
  'Isotipo.svg': 'isotipo',
  'Isotipo+Wordmark+Rectangular.svg': 'logo-horizontal',
  'Isotipo+Wordmark+Cuadrado.svg': 'logo-cuadrado',
  'Isotipo+Wordmark+DescripcionDebajo+Cuadrado.svg': 'logo-desc-debajo-cuadrado',
  'Isotipo+Wordmark+DescripcionDebajo+Rectangular.svg': 'logo-desc-debajo-horizontal',
}

async function renderTrimmed(file, width = 1600) {
  // density alta para raster nítido, fondo transparente
  const buf = await sharp(join(srcDir, file), { density: 300 })
    .resize({ width, withoutEnlargement: true })
    .png()
    .toBuffer()
  // recorta padding transparente/blanco de la composición
  const trimmed = await sharp(buf).trim({ threshold: 8 }).png().toBuffer()
  return trimmed
}

for (const [file, name] of Object.entries(MAP)) {
  const composed = await renderTrimmed(file)
  const meta = await sharp(composed).metadata()
  console.log(`${name}: ${meta.width}x${meta.height}`)

  if (name === 'isotipo') {
    for (const size of [32, 180, 192, 512]) {
      const png = await sharp(composed)
        .resize(size, size, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer()
      writeFileSync(join(outDir, `isotipo-${size}.png`), png)
    }
    const maskable = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 109, g: 40, b: 217, alpha: 1 } },
    })
      .composite([{ input: await sharp(composed).resize(410, 410, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toBuffer()
    writeFileSync(join(outDir, 'isotipo-512-maskable.png'), maskable)
    const webp = await sharp(composed).resize(256, 256, { fit: 'inside' }).webp({ quality: 85 }).toBuffer()
    writeFileSync(join(outDir, 'isotipo-256.webp'), webp)
  } else {
    for (const w of [256, 512, 768]) {
      const webp = await sharp(composed).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
      writeFileSync(join(outDir, `${name}-${w}.webp`), webp)
      const avif = await sharp(composed).resize({ width: w, withoutEnlargement: true }).avif({ quality: 60 }).toBuffer()
      writeFileSync(join(outDir, `${name}-${w}.avif`), avif)
    }
    const fallback = await sharp(composed).resize({ width: 1024, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer()
    writeFileSync(join(outDir, `${name}.png`), fallback)
  }
}
console.log('brand ok -> public/brand/')
