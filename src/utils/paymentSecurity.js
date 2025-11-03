require('dotenv').config();
const crypto = require('crypto');

/*
 * TEST CARD NUMBERS
 * VISA Test Cards:
 *   4242 4242 4242 4242
 *   4111 1111 1111 1111
 * 
 * MASTERCARD Test Cards:
 *   5555 5555 5555 4444
 *   2223 0031 2200 3222
 * 
 * AMEX Test Cards:
 *   3782 822463 10005
 *   3714 496353 98431
 * 
 * DISCOVER Test Cards:
 *   6011 1111 1111 1117
 *   6011 0009 9013 9424
 * 
 * Test CVV: Any 3-4 digits (e.g., 123, 0000)
 * Test Expiration: Use future dates (e.g., 12/25, 01/26)
 */

const ENCRYPTION_KEY = process.env.PAYMENT_ENCRYPTION_KEY;
const CVC_HMAC_SECRET = process.env.CVC_HMAC_SECRET;

// Generate card hash for duplicate checking
exports.generateCardHash = (cardNumber, userId) => {
    const cleanedCard = cardNumber.toString().replace(/\s/g, '');
    const hashInput = `${cleanedCard}:${userId}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
};

// Encrypt PAN 
exports.encryptPAN = (cardNumber) => {
    const algorithm = 'aes-256-gcm';
    let key;
    if (ENCRYPTION_KEY.length === 64) {
        key = Buffer.from(ENCRYPTION_KEY, 'hex');
    }
    
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(cardNumber.toString(), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
};

// Decrypt PAN when needed (e.g., for refunds)
exports.decryptPAN = (encryptedData) => {
    if (!encryptedData || typeof encryptedData !== 'string') {
        throw new Error('Invalid encrypted data: must be a non-empty string');
    }
    
    const algorithm = 'aes-256-gcm';
    let key;
    if (ENCRYPTION_KEY.length === 64) {
        key = Buffer.from(ENCRYPTION_KEY, 'hex');
    }
    
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format: expected iv:encrypted:authTag');
    }
    
    const [ivHex, encrypted, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
};

// Generate masked PAN for display from last4 and pan_length (XXXX-XXXX-XXXX-1234)
exports.generateMaskedPAN = (last4, panLength) => {
    const maskedLength = Math.max(0, panLength - 4);
    const masked = 'X'.repeat(maskedLength);
    // Format with dashes every 4 characters
    let formatted = masked;
    if (masked.length > 0) {
        const chunks = masked.match(/.{1,4}/g) || [];
        formatted = chunks.join('-');
    }
    return `${formatted}-${last4}`;
};

// Create HMAC for CVC verification
exports.createCVCHMAC = (cvc) => {
    return crypto
        .createHmac('sha256', CVC_HMAC_SECRET)
        .update(cvc.toString())
        .digest('hex');
};

// Verify CVC against stored HMAC
exports.verifyCVC = (cvc, storedHMAC) => {
    const computedHMAC = exports.createCVCHMAC(cvc);
    try {
        return crypto.timingSafeEqual(
            Buffer.from(computedHMAC),
            Buffer.from(storedHMAC)
        );
    } catch (error) {
        return false;
    }
};

// 1. Luhn Algorithm (Mod 10) - Validates credit card number checksum
exports.validateLuhn = (cardNumber) => {
    // Remove all spaces and non-numeric characters
    const digits = cardNumber.toString().replace(/\s/g, '').replace(/\D/g, '');
    
    // Must contain only digits and be at least 13 digits
    if (!/^\d{13,19}$/.test(digits)) {
        return false;
    }
    
    let sum = 0;
    let isEven = false;
    
    // Process from right to left
    for (let i = digits.length - 1; i >= 0; i--) {
        let digit = parseInt(digits[i]);
        
        if (isEven) {
            // Double every second digit from right
            digit *= 2;
            // If doubling results in two-digit number, subtract 9
            if (digit > 9) {
                digit -= 9;
            }
        }
        
        sum += digit;
        isEven = !isEven;
    }
    
    // Valid if sum is divisible by 10
    return sum % 10 === 0;
};

// 2. Detect card brand from card number
exports.detectCardBrand = (cardNumber) => {
    // Remove all spaces and non-numeric characters
    const digits = cardNumber.toString().replace(/\s/g, '').replace(/\D/g, '');
    
    // Visa: starts with 4, 13 or 16 digits
    if (/^4/.test(digits)) {
        return 'VISA';
    }
    
    // Mastercard: starts with 51-55 or 2221-2720, 16 digits
    if (/^5[1-5]/.test(digits)) {
        return 'MASTERCARD';
    }
    // Check for Mastercard range 2221-2720 (numeric check for accuracy)
    if (/^22/.test(digits)) {
        const prefix4 = parseInt(digits.substring(0, 4));
        if (prefix4 >= 2221 && prefix4 <= 2720) {
            return 'MASTERCARD';
        }
    }
    
    // American Express: starts with 34 or 37, 15 digits
    if (/^3[47]/.test(digits)) {
        return 'AMEX';
    }
    
    // Discover: starts with 6011, 622126-622925, 644-649, 65, 16 digits
    if (/^6011/.test(digits) || /^622[1-9]/.test(digits) || /^64[4-9]/.test(digits) || /^65/.test(digits)) {
        return 'DISCOVER';
    }
    
    // Diners Club: starts with 300-305, 36, or 38, 14 digits
    if (/^3[068]/.test(digits) || /^30[0-5]/.test(digits)) {
        return 'DINERS_CLUB';
    }
    
    // JCB: starts with 35, 16 digits
    if (/^35/.test(digits)) {
        return 'JCB';
    }
    
    return null; // Unknown brand
};

// 3. Validate card number format (length by brand)
exports.validateCardFormat = (cardNumber, brand) => {
    // Remove all spaces and non-numeric characters
    const digits = cardNumber.toString().replace(/\s/g, '').replace(/\D/g, '');
    const length = digits.length;
    
    // Card length requirements by brand
    const brandLengths = {
        'VISA': [13, 16],
        'MASTERCARD': [16],
        'AMEX': [15],
        'DISCOVER': [16],
        'DINERS_CLUB': [14],
        'JCB': [16]
    };
    
    // If brand not provided, try to detect it
    const detectedBrand = brand || exports.detectCardBrand(cardNumber);
    
    if (!detectedBrand) {
        return { valid: false, error: 'Unable to detect card brand' };
    }
    
    // Check if length matches brand requirements
    const validLengths = brandLengths[detectedBrand];
    if (!validLengths || !validLengths.includes(length)) {
        return { 
            valid: false, 
            error: `Invalid card number length for ${detectedBrand}. Expected ${validLengths.join(' or ')} digits, got ${length}` 
        };
    }
    
    // Check if provided brand matches detected brand
    if (brand && brand !== detectedBrand) {
        return { 
            valid: false, 
            error: `Card number does not match brand ${brand}. Detected brand: ${detectedBrand}` 
        };
    }
    
    return { valid: true, brand: detectedBrand };
};

// Combined validation function that checks all three
exports.validateCardNumber = (cardNumber, providedBrand = null) => {
    // Clean the card number
    const cleaned = cardNumber.toString().replace(/\s/g, '').replace(/\D/g, '');
    
    // Check if empty or too short
    if (!cleaned || cleaned.length < 13) {
        return { valid: false, error: 'Card number is too short' };
    }
    
    // Check Luhn algorithm
    if (!exports.validateLuhn(cleaned)) {
        return { valid: false, error: 'Invalid card number (failed Luhn checksum)' };
    }
    
    // Check format and brand
    const formatCheck = exports.validateCardFormat(cleaned, providedBrand);
    if (!formatCheck.valid) {
        return formatCheck;
    }
    
    return { valid: true, brand: formatCheck.brand };
};

