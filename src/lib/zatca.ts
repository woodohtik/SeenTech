/** A TLV field's length is a single byte. */
export const TLV_MAX_BYTES = 255;

/**
 * seen-readiness-fixes-task.md P6 (CODEHEALTH-11): the length byte used to
 * wrap around for a value over 255 bytes (a long Arabic seller name is 2
 * bytes a letter), which corrupted every field after it in the QR. A value
 * that long is now cut to fit, on a whole character.
 */
export function fitTlvValue(value: string): Uint8Array {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length <= TLV_MAX_BYTES) return bytes;
    let end = TLV_MAX_BYTES;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--; // not in the middle of a UTF-8 character
    return bytes.slice(0, end);
}

export function toTLV(tag: number, value: string): Uint8Array {
    const valueBytes = fitTlvValue(value);
    const tagBytes = new Uint8Array([tag]);
    const lengthBytes = new Uint8Array([valueBytes.length]);

    const tlv = new Uint8Array(tagBytes.length + lengthBytes.length + valueBytes.length);
    tlv.set(tagBytes, 0);
    tlv.set(lengthBytes, tagBytes.length);
    tlv.set(valueBytes, tagBytes.length + lengthBytes.length);

    return tlv;
}

export function generateZatcaQR(
    sellerName: string,
    trn: string,
    timestamp: string,
    total: string,
    vatAmount: string
): string {
    const tlv1 = toTLV(1, sellerName);
    const tlv2 = toTLV(2, trn);
    const tlv3 = toTLV(3, timestamp);
    const tlv4 = toTLV(4, total);
    const tlv5 = toTLV(5, vatAmount);

    const totalLength = tlv1.length + tlv2.length + tlv3.length + tlv4.length + tlv5.length;
    const allTLV = new Uint8Array(totalLength);
    let offset = 0;
    
    allTLV.set(tlv1, offset); offset += tlv1.length;
    allTLV.set(tlv2, offset); offset += tlv2.length;
    allTLV.set(tlv3, offset); offset += tlv3.length;
    allTLV.set(tlv4, offset); offset += tlv4.length;
    allTLV.set(tlv5, offset); offset += tlv5.length;

    // Convert Uint8Array to base64
    let binary = '';
    const len = allTLV.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(allTLV[i]);
    }
    return btoa(binary);
}
