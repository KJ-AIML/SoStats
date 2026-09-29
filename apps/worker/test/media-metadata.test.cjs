const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMediaMetadata } = require('../dist/media/media-metadata.js');

function box(type, data) {
  const result = Buffer.alloc(8 + data.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, 'ascii');
  data.copy(result, 8);
  return result;
}

test('extracts PNG dimensions', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
  png.writeUInt32BE(1920, 16);
  png.writeUInt32BE(1080, 20);

  assert.deepEqual(extractMediaMetadata(png, 'image/png'), {
    width: 1920,
    height: 1080,
  });
});

test('extracts GIF dimensions', () => {
  const gif = Buffer.alloc(10);
  gif.write('GIF89a', 0, 'ascii');
  gif.writeUInt16LE(640, 6);
  gif.writeUInt16LE(480, 8);

  assert.deepEqual(extractMediaMetadata(gif, 'image/gif'), {
    width: 640,
    height: 480,
  });
});

test('extracts JPEG SOF dimensions', () => {
  const jpeg = Buffer.alloc(2 + 2 + 17);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  jpeg[2] = 0xff;
  jpeg[3] = 0xc0;
  jpeg.writeUInt16BE(17, 4);
  jpeg[6] = 8;
  jpeg.writeUInt16BE(720, 7);
  jpeg.writeUInt16BE(1280, 9);

  assert.deepEqual(extractMediaMetadata(jpeg, 'image/jpeg'), {
    width: 1280,
    height: 720,
  });
});

test('extracts MP4 duration and video dimensions', () => {
  const mvhdData = Buffer.alloc(100);
  mvhdData[0] = 0;
  mvhdData.writeUInt32BE(1000, 12);
  mvhdData.writeUInt32BE(2500, 16);

  const tkhdData = Buffer.alloc(84);
  tkhdData[0] = 0;
  tkhdData.writeUInt32BE(1920 * 65536, tkhdData.length - 8);
  tkhdData.writeUInt32BE(1080 * 65536, tkhdData.length - 4);

  const trak = box('trak', box('tkhd', tkhdData));
  const moov = box('moov', Buffer.concat([box('mvhd', mvhdData), trak]));

  assert.deepEqual(extractMediaMetadata(moov, 'video/mp4'), {
    width: 1920,
    height: 1080,
    durationMs: 2500,
  });
});
