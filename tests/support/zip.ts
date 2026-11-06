// Minimal ZIP reader for .xlsx files (an .xlsx is a ZIP of XML files). Tests only; no dependency.
// Supports "stored" and "deflate" entries, which is all write-excel-file produces.
import { inflateRawSync } from "node:zlib";

export function unzip(bytes: Uint8Array): Record<string, Buffer> {
  const buf = Buffer.from(bytes);
  // End of central directory record: signature 0x06054b50, searched from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no end-of-central-directory record)");
  const entries = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("Corrupt central directory");
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    // The local header repeats name and extra lengths; the data starts after them.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    out[name] = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Text of every `<si>` in xl/sharedStrings.xml, XML-unescaped. */
export function sharedStrings(files: Record<string, Buffer>): string[] {
  const xml = files["xl/sharedStrings.xml"]?.toString("utf8") ?? "";
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => t[1])
      .join("")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&"),
  );
}
