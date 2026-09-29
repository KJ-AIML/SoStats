import { strict as assert } from 'node:assert';
import { extractMediaMetadata } from './media-metadata';

const png = Buffer.alloc(24);
png.set(Buffer.from('89504e470d0a1a0a', 'hex'), 0);
png.writeUInt32BE(1920, 16);
png.writeUInt32BE(1080, 20);

const gif = Buffer.alloc(10);
gif.write('GIF89a', 0, 'ascii');
gif.writeUInt16LE(640, 6);
gif.writeUInt16LE(480, 8);

assert.deepEqual(extractMediaMetadata(png, 'image/png'), {
  width: 1920,
  height: 1080,
});
assert.deepEqual(extractMediaMetadata(gif, 'image/gif'), {
  width: 640,
  height: 480,
});

console.log('[MediaMetadata] parser checks passed');
