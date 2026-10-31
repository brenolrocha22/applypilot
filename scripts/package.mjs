// Gera o pacote .zip da extensão (dist/) para publicar nas lojas — o mesmo arquivo serve para
// Chrome Web Store e Microsoft Edge Add-ons (e para Opera/Brave, que aceitam extensões Chromium).
// Uso: npm run build && node scripts/package.mjs
import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';
if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('dist/ não encontrado. Rode "npm run build" antes.');
const { version } = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

const locals = [];
const centrals = [];
let offset = 0;
for (const file of walk(DIST).sort()) {
  const name = Buffer.from(relative(DIST, file).split(sep).join('/'), 'utf8');
  const raw = readFileSync(file);
  const data = deflateRawSync(raw, { level: 9 });
  const crc = crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  locals.push(local, name, data);
  centrals.push(central, name);
  offset += local.length + name.length + data.length;
}
const cd = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(centrals.length / 2, 8);
eocd.writeUInt16LE(centrals.length / 2, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);

mkdirSync('release', { recursive: true });
const out = join('release', `applypilot-${version}.zip`);
writeFileSync(out, Buffer.concat([...locals, cd, eocd]));
console.log(`Pacote gerado: ${out} (${centrals.length / 2} arquivos, ${(statSync(out).size / 1024).toFixed(0)} KB)`);
console.log('Serve para: Chrome Web Store, Microsoft Edge Add-ons, Opera Add-ons.');
