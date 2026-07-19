class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.publicMessage = message;
  }
}

function assertPlainObject(value, message = 'รูปแบบข้อมูลไม่ถูกต้อง') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message);
  }
  return value;
}

function stringValue(value, label, options = {}) {
  const {
    required = false,
    min = 0,
    max = 5000,
    trim = true,
    allowNull = false,
  } = options;

  if (value === undefined) {
    if (required) throw new ValidationError(`กรุณาระบุ${label}`);
    return undefined;
  }
  if (value === null && allowNull) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label}ต้องเป็นข้อความ`);

  const normalized = trim ? value.trim() : value;
  if (required && normalized.length < Math.max(1, min)) {
    throw new ValidationError(`${label}ต้องยาวอย่างน้อย ${Math.max(1, min)} ตัวอักษร`);
  }
  if (!required && normalized.length > 0 && normalized.length < min) {
    throw new ValidationError(`${label}ต้องยาวอย่างน้อย ${min} ตัวอักษร`);
  }
  if (normalized.length > max) throw new ValidationError(`${label}ต้องยาวไม่เกิน ${max} ตัวอักษร`);
  return normalized;
}

function booleanValue(value, label, options = {}) {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError(`${label}ต้องเป็น true หรือ false`);
  return value;
}

function integerValue(value, label, options = {}) {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${label}ต้องเป็นจำนวนเต็ม`);
  }
  if (options.allowed && !options.allowed.includes(value)) {
    throw new ValidationError(`${label}ไม่ถูกต้อง`);
  }
  if (options.min !== undefined && value < options.min) throw new ValidationError(`${label}ต่ำกว่าค่าที่อนุญาต`);
  if (options.max !== undefined && value > options.max) throw new ValidationError(`${label}สูงกว่าค่าที่อนุญาต`);
  return value;
}

function positiveId(value, label = 'รหัสรายการ') {
  const text = String(value || '');
  if (!/^\d+$/.test(text)) throw new ValidationError(`${label}ไม่ถูกต้อง`);
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError(`${label}ไม่ถูกต้อง`);
  return id;
}

function isoDateValue(value, label = 'วันและเวลา', options = {}) {
  if (value === undefined && options.optional) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new ValidationError(`${label}ต้องเป็น ISO-8601 ที่มีเขตเวลา`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${label}ไม่ถูกต้อง`);
  return date.toISOString();
}

function timeValue(value, label = 'เวลา') {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ValidationError(`${label}ต้องอยู่ในรูปแบบ HH:mm`);
  }
  return value;
}

function passwordValue(value, label = 'รหัสผ่าน', options = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${label}ต้องเป็นข้อความ`);
  const bytes = Buffer.byteLength(value, 'utf8');
  const minChars = options.minChars ?? 12;
  const minBytes = options.minBytes ?? minChars;
  if (Array.from(value).length < minChars || bytes < minBytes) {
    throw new ValidationError(`${label}ต้องยาวอย่างน้อย ${minChars} ตัวอักษร`);
  }
  if (bytes > 72) throw new ValidationError(`${label}ต้องยาวไม่เกิน 72 ไบต์`);
  return value;
}

module.exports = {
  ValidationError,
  assertPlainObject,
  stringValue,
  booleanValue,
  integerValue,
  positiveId,
  isoDateValue,
  timeValue,
  passwordValue,
};
