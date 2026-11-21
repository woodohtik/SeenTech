import { describe, expect, test, vi } from 'vitest';

vi.mock('../lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../lib/tenantRow', () => ({ readTenantRow: vi.fn() }));

import {
  legacyOrderStatusFor, mapStageKeyToLegacyStatus, localizedLabel, localizedOptions, localizedVerticalName, stagePhase,
} from './verticalService';
import type { WorkflowStage } from '../types/expansion';

const stage = (vertical_key: string, stage_key: string, extra: Partial<WorkflowStage> = {}): WorkflowStage => ({
  vertical_key, stage_key, label_ar: stage_key, sort: 1, is_terminal: false, ...extra,
});

// seen-verticals-readiness-task.md Phase 1 / bug 1.
describe('which status a stage writes', () => {
  test("the stage's own legacy_status decides", () => {
    const furniture = [
      stage('furniture', 'design_approval', { phase: 'in_progress', legacy_status: 'measurements_taken' }),
      stage('furniture', 'upholstery', { phase: 'in_progress', legacy_status: 'cutting', consumes_materials: true }),
      stage('furniture', 'ready', { phase: 'ready', legacy_status: 'ready' }),
    ];
    expect(legacyOrderStatusFor('design_approval', furniture)).toBe('measurements_taken');
    expect(legacyOrderStatusFor('upholstery', furniture)).toBe('cutting');
    expect(legacyOrderStatusFor('ready', furniture)).toBe('ready');
  });

  test("men's stages are the enum itself, loaded or not", () => {
    for (const k of ['measurements_taken', 'cutting', 'sewing', 'embroidery', 'ironing_packaging', 'ready', 'partial_delivered', 'delivered', 'cancelled']) {
      expect(legacyOrderStatusFor(k, [])).toBe(k);
      expect(legacyOrderStatusFor(k, [stage('mens_tailoring', k, { legacy_status: k })])).toBe(k);
    }
  });

  test('an older database (no legacy_status): a non-enum stage is never stored as ready', () => {
    expect(legacyOrderStatusFor('fitting', [stage('womens_tailoring', 'fitting')])).toBe('measurements_taken');
    expect(legacyOrderStatusFor('done', [stage('x', 'done', { is_terminal: true })])).toBe('delivered');
    expect(mapStageKeyToLegacyStatus('design_approval', false)).not.toBe('ready');
  });

  test('an unknown stage is an error, not a guess', () => {
    expect(() => legacyOrderStatusFor('nonexistent', [])).toThrow(/Unknown order stage/);
  });

  test('stagePhase', () => {
    const stages = [stage('fabric_store', 'ready_pickup', { phase: 'ready' })];
    expect(stagePhase('ready_pickup', stages)).toBe('ready');
    expect(stagePhase('x', stages)).toBeNull();
    expect(stagePhase(null, stages)).toBeNull();
  });
});

describe('labels in the screen language', () => {
  const row = { label_ar: 'تنجيد', label_en: 'Upholstery', label_ur: 'اپہولسٹری' };
  test('label_en / label_ur, Arabic otherwise', () => {
    expect(localizedLabel(row, 'ar')).toBe('تنجيد');
    expect(localizedLabel(row, 'en')).toBe('Upholstery');
    expect(localizedLabel(row, 'ur')).toBe('اپہولسٹری');
    expect(localizedLabel({ label_ar: 'تنجيد' }, 'en')).toBe('تنجيد');
    expect(localizedVerticalName({ name_ar: 'أثاث وتنجيد', name_en: 'Furniture', name_ur: null }, 'ur')).toBe('أثاث وتنجيد');
  });

  test('select options keep the stored Arabic value and show the translation', () => {
    const field = { options: ['مخمل', 'جلد'], options_i18n: { en: ['Velvet', 'Leather'] } };
    expect(localizedOptions(field, 'en')).toEqual([{ value: 'مخمل', label: 'Velvet' }, { value: 'جلد', label: 'Leather' }]);
    expect(localizedOptions(field, 'ur')).toEqual([{ value: 'مخمل', label: 'مخمل' }, { value: 'جلد', label: 'جلد' }]);
  });
});
