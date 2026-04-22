/**
 * @param {ReadableStream<Uint8Array>|null|undefined} stream
 * @returns {Promise<Buffer>}
 */
export async function webReadableStreamToBuffer(stream) {
  if (!stream) {
    return Buffer.alloc(0);
  }
  const reader = stream.getReader();
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
