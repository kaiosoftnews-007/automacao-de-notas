// Lê um .zip (deflate ou sem compressão) e devolve [{ caminho, dados: Uint8Array }].
// Confere o CRC32 de cada arquivo. Sem bibliotecas: usa DecompressionStream.

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflar(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function lerZip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Fim do diretório central (procura de trás para frente)
  let fim = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('Arquivo baixado não é um zip válido.');

  const total = dv.getUint16(fim + 10, true);
  let p = dv.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const saida = [];

  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Zip corrompido (diretório).');
    const metodo = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const tamC = dv.getUint32(p + 20, true);
    const tamU = dv.getUint32(p + 24, true);
    const lNome = dv.getUint16(p + 28, true);
    const lExtra = dv.getUint16(p + 30, true);
    const lCom = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const caminho = dec.decode(u8.subarray(p + 46, p + 46 + lNome));
    p += 46 + lNome + lExtra + lCom;

    if (caminho.endsWith('/')) continue; // pasta
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error('Zip corrompido (arquivo).');
    const ini = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const bruto = u8.subarray(ini, ini + tamC);

    let dados;
    if (metodo === 0) dados = bruto.slice();
    else if (metodo === 8) dados = await inflar(bruto);
    else throw new Error(`Compressão não suportada em ${caminho}.`);

    if (dados.length !== tamU || crc32(dados) !== crc) {
      throw new Error(`Arquivo danificado no download: ${caminho}.`);
    }
    saida.push({ caminho, dados });
  }
  return saida;
}
