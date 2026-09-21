import { describe, expect, it } from 'vitest';
import {
  exportPath,
  staticExportPages,
} from '../server/exporter.js';

describe('the static Development export', () => {
  it('crawls both payloads required by Scouted Development', () => {
    const pages = staticExportPages(7, [7, 70]);

    expect(pages).toContain('development-history/7');
    expect(pages).toContain('scouted-development/7');
    expect(pages).toContain('farm-operations/7');
  });

  it('stores the new payloads through the existing static API path mapping', () => {
    expect(exportPath('/api/development-history/7')).toBe('development-history/7');
    expect(exportPath('/api/scouted-development/7')).toBe('scouted-development/7');
    expect(exportPath('/api/farm-operations/7')).toBe('farm-operations/7');
  });
});
