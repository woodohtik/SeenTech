export function generateZatcaQR(
  sellerName: string,
  vatRegistrationNumber: string,
  timestamp: string,
  invoiceTotal: string,
  vatTotal: string
): string {
  const getBytes = (value: string): Uint8Array => {
    return new TextEncoder().encode(value);
  };

  const createTag = (tag: number, value: string): Uint8Array => {
    const valueBytes = getBytes(value);
    const tagBuffer = new Uint8Array(2 + valueBytes.length);
    tagBuffer[0] = tag;
    tagBuffer[1] = valueBytes.length;
    tagBuffer.set(valueBytes, 2);
    return tagBuffer;
  };

  const tags = [
    createTag(1, sellerName),
    createTag(2, vatRegistrationNumber),
    createTag(3, timestamp),
    createTag(4, invoiceTotal),
    createTag(5, vatTotal)
  ];

  const totalLength = tags.reduce((acc, tag) => acc + tag.length, 0);
  const qrBuffer = new Uint8Array(totalLength);
  
  let offset = 0;
  tags.forEach(tag => {
    qrBuffer.set(tag, offset);
    offset += tag.length;
  });

  // Convert Uint8Array to base64 safely
  let binary = '';
  const len = qrBuffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(qrBuffer[i]);
  }
  
  return btoa(binary);
}
