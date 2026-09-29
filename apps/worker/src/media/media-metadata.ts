export type MediaMetadata = {
  width: number;
  height: number;
  durationMs?: number;
};

function assertRange(buffer: Buffer, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error('Media file ended before metadata could be read');
  }
}

function parsePng(buffer: Buffer): MediaMetadata {
  assertRange(buffer, 0, 24);
  if (
    buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  ) {
    throw new Error('Invalid PNG signature');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGif(buffer: Buffer): MediaMetadata {
  assertRange(buffer, 0, 10);
  const signature = buffer.subarray(0, 6).toString('ascii');
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw new Error('Invalid GIF signature');
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseJpeg(buffer: Buffer): MediaMetadata {
  assertRange(buffer, 0, 4);
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Invalid JPEG signature');
  }

  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;

    assertRange(buffer, offset, 2);
    const length = buffer.readUInt16BE(offset);
    if (length < 2) throw new Error('Invalid JPEG segment length');

    if (sofMarkers.has(marker)) {
      assertRange(buffer, offset, 7);
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += length;
  }

  throw new Error('JPEG dimensions were not found');
}

function readUInt24LE(buffer: Buffer, offset: number) {
  assertRange(buffer, offset, 3);
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16)
  );
}

function parseWebp(buffer: Buffer): MediaMetadata {
  assertRange(buffer, 0, 30);
  if (
    buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error('Invalid WebP signature');
  }

  const chunk = buffer.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    };
  }

  if (chunk === 'VP8L') {
    assertRange(buffer, 20, 5);
    if (buffer[20] !== 0x2f) {
      throw new Error('Invalid lossless WebP header');
    }
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }

  if (chunk === 'VP8 ') {
    let offset = 20;
    const end = Math.min(buffer.length - 10, 80);
    while (offset <= end) {
      if (
        buffer[offset + 3] === 0x9d &&
        buffer[offset + 4] === 0x01 &&
        buffer[offset + 5] === 0x2a
      ) {
        return {
          width: buffer.readUInt16LE(offset + 6) & 0x3fff,
          height: buffer.readUInt16LE(offset + 8) & 0x3fff,
        };
      }
      offset += 1;
    }
  }

  throw new Error('Unsupported WebP frame header');
}

type Mp4Box = {
  type: string;
  start: number;
  dataStart: number;
  end: number;
};

function mp4Boxes(buffer: Buffer, start = 0, end = buffer.length): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    let headerSize = 8;

    if (size === 1) {
      assertRange(buffer, offset + 8, 8);
      const big = buffer.readBigUInt64BE(offset + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('MP4 box is too large to process safely');
      }
      size = Number(big);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) {
      throw new Error(`Invalid MP4 box ${type}`);
    }

    boxes.push({
      type,
      start: offset,
      dataStart: offset + headerSize,
      end: offset + size,
    });
    offset += size;
  }

  return boxes;
}

function mp4Duration(buffer: Buffer, mvhd: Mp4Box) {
  assertRange(buffer, mvhd.dataStart, 32);
  const version = buffer[mvhd.dataStart];

  if (version === 1) {
    const timescale = buffer.readUInt32BE(mvhd.dataStart + 20);
    const duration = buffer.readBigUInt64BE(mvhd.dataStart + 24);
    if (!timescale) throw new Error('MP4 has invalid timescale');
    return Number(duration * 1000n / BigInt(timescale));
  }

  const timescale = buffer.readUInt32BE(mvhd.dataStart + 12);
  const duration = buffer.readUInt32BE(mvhd.dataStart + 16);
  if (!timescale) throw new Error('MP4 has invalid timescale');
  return Math.round((duration / timescale) * 1000);
}

function mp4TrackDimensions(buffer: Buffer, tkhd: Mp4Box) {
  assertRange(buffer, tkhd.start, tkhd.end - tkhd.start);
  if (tkhd.end - tkhd.dataStart < 8) {
    throw new Error('MP4 track header is incomplete');
  }

  const widthFixed = buffer.readUInt32BE(tkhd.end - 8);
  const heightFixed = buffer.readUInt32BE(tkhd.end - 4);
  return {
    width: Math.round(widthFixed / 65536),
    height: Math.round(heightFixed / 65536),
  };
}

function parseMp4(buffer: Buffer): MediaMetadata {
  const top = mp4Boxes(buffer);
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) throw new Error('MP4 moov metadata was not found');

  const children = mp4Boxes(buffer, moov.dataStart, moov.end);
  const mvhd = children.find((box) => box.type === 'mvhd');
  if (!mvhd) throw new Error('MP4 duration metadata was not found');

  const dimensions = children
    .filter((box) => box.type === 'trak')
    .map((trak) => {
      const tkhd = mp4Boxes(buffer, trak.dataStart, trak.end).find(
        (box) => box.type === 'tkhd',
      );
      return tkhd ? mp4TrackDimensions(buffer, tkhd) : null;
    })
    .filter(
      (value): value is { width: number; height: number } =>
        Boolean(value && value.width > 0 && value.height > 0),
    )
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];

  if (!dimensions) {
    throw new Error('MP4 video dimensions were not found');
  }

  return {
    ...dimensions,
    durationMs: mp4Duration(buffer, mvhd),
  };
}

export function extractMediaMetadata(
  buffer: Buffer,
  mimeType: string,
): MediaMetadata {
  if (mimeType === 'image/png') return parsePng(buffer);
  if (mimeType === 'image/jpeg') return parseJpeg(buffer);
  if (mimeType === 'image/gif') return parseGif(buffer);
  if (mimeType === 'image/webp') return parseWebp(buffer);
  if (mimeType === 'video/mp4') return parseMp4(buffer);
  throw new Error(`Unsupported media type ${mimeType}`);
}
