import { describe, it, expect } from 'vitest';
import { _validateFiles as validateFiles } from './useFileUpload';

const MAX_ATTACHMENTS = 10;
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;

function file(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('validateFiles — accepted types', () => {
  it('accepts PDF by mime', () => {
    const { valid, errors } = validateFiles(
      [file('doc.pdf', 'application/pdf')], 0, MAX_ATTACHMENTS, MAX_IMAGE, MAX_FILE,
    );
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('accepts HTML by mime', () => {
    const { valid, errors } = validateFiles(
      [file('page.html', 'text/html')], 0, MAX_ATTACHMENTS, MAX_IMAGE, MAX_FILE,
    );
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('accepts HTML by extension when mime is empty', () => {
    const { valid, errors } = validateFiles(
      [file('page.htm', '')], 0, MAX_ATTACHMENTS, MAX_IMAGE, MAX_FILE,
    );
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('accepts arbitrary types now that any file is allowed (e.g. xlsx, md, exe)', () => {
    const { valid, errors } = validateFiles(
      [
        file('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        file('notes.md', ''),
        file('tool.exe', 'application/x-msdownload'),
      ], 0, MAX_ATTACHMENTS, MAX_IMAGE, MAX_FILE,
    );
    expect(valid).toHaveLength(3);
    expect(errors).toHaveLength(0);
  });

  it('rejects a PDF over the file size limit', () => {
    const { valid, errors } = validateFiles(
      [file('big.pdf', 'application/pdf', MAX_FILE + 1)], 0, MAX_ATTACHMENTS, MAX_IMAGE, MAX_FILE,
    );
    expect(valid).toHaveLength(0);
    expect(errors[0].reason).toBe('size');
  });
});
