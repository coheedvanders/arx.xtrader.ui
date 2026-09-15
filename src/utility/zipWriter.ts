// Intended location: src/utility/zipWriter.ts
//
// A minimal, dependency-free ZIP writer — "store" method only (no
// compression), which is fine here: the payload is JSON research data,
// not something where file size is critical, and it avoids pulling in
// an external library (jszip or similar) whose availability in this
// project isn't known. Implements just enough of the ZIP spec to
// produce a file every standard unzip tool can open: local file
// headers, a central directory, and the end-of-central-directory
// record, each with a real CRC-32 (required — many unzip tools reject
// an archive with a zero/fake checksum).

export interface ZipEntry {
    name: string;
    content: string;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
    const time =
        ((date.getHours() & 0x1f) << 11) |
        ((date.getMinutes() & 0x3f) << 5) |
        ((date.getSeconds() >> 1) & 0x1f);
    const dosDate =
        (((date.getFullYear() - 1980) & 0x7f) << 9) |
        (((date.getMonth() + 1) & 0xf) << 5) |
        (date.getDate() & 0x1f);
    return { time, date: dosDate };
}

class ByteWriter {
    private chunks: Uint8Array[] = [];
    private length = 0;

    push(bytes: Uint8Array) {
        this.chunks.push(bytes);
        this.length += bytes.length;
    }

    u16(value: number) {
        this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
    }

    u32(value: number) {
        this.push(
            new Uint8Array([
                value & 0xff,
                (value >>> 8) & 0xff,
                (value >>> 16) & 0xff,
                (value >>> 24) & 0xff,
            ])
        );
    }

    get offset(): number {
        return this.length;
    }

    toUint8Array(): Uint8Array {
        const out = new Uint8Array(this.length);
        let pos = 0;
        for (const chunk of this.chunks) {
            out.set(chunk, pos);
            pos += chunk.length;
        }
        return out;
    }
}

/**
 * Builds a real ZIP archive (store method) from a set of named text
 * entries, returned as a Blob ready for a download link. Every entry
 * shares one "captured now" timestamp for its DOS date/time fields —
 * good enough for a research bundle; nobody needs per-file mtimes here.
 */
export function buildZip(entries: ZipEntry[]): Blob {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const w = new ByteWriter();
    const centralRecords: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = [];

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name);
        const dataBytes = encoder.encode(entry.content);
        const crc = crc32(dataBytes);
        const localOffset = w.offset;

        w.u32(0x04034b50); // local file header signature
        w.u16(20); // version needed
        w.u16(0); // flags
        w.u16(0); // compression method: store
        w.u16(time);
        w.u16(date);
        w.u32(crc);
        w.u32(dataBytes.length); // compressed size == uncompressed for store
        w.u32(dataBytes.length);
        w.u16(nameBytes.length);
        w.u16(0); // extra field length
        w.push(nameBytes);
        w.push(dataBytes);

        centralRecords.push({ nameBytes, crc, size: dataBytes.length, offset: localOffset });
    }

    const centralDirStart = w.offset;
    for (const rec of centralRecords) {
        w.u32(0x02014b50); // central directory file header signature
        w.u16(20); // version made by
        w.u16(20); // version needed
        w.u16(0); // flags
        w.u16(0); // compression method
        w.u16(time);
        w.u16(date);
        w.u32(rec.crc);
        w.u32(rec.size);
        w.u32(rec.size);
        w.u16(rec.nameBytes.length);
        w.u16(0); // extra field length
        w.u16(0); // comment length
        w.u16(0); // disk number start
        w.u16(0); // internal file attributes
        w.u32(0); // external file attributes
        w.u32(rec.offset);
        w.push(rec.nameBytes);
    }
    const centralDirSize = w.offset - centralDirStart;

    w.u32(0x06054b50); // end of central directory signature
    w.u16(0); // disk number
    w.u16(0); // disk with central directory
    w.u16(centralRecords.length); // entries on this disk
    w.u16(centralRecords.length); // total entries
    w.u32(centralDirSize);
    w.u32(centralDirStart);
    w.u16(0); // comment length

    return new Blob([w.toUint8Array().buffer as ArrayBuffer], { type: "application/zip" });
}