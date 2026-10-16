import { describe, expect, it } from 'vitest';
import { groupModels } from '@/renderer/pages/conversation/runtime/Continuity/models';

describe('Xuzhou software/model choices', () => {
  it('keeps identical model names separate across software', () => {
    const groups = groupModels(
      [
        { id: 'codex/shared', label: 'Shared' },
        { id: 'kiro-v3/shared', label: 'Shared' },
      ],
      ''
    );
    expect(groups.map((group) => group.models[0].id)).toEqual(['codex/shared', 'kiro-v3/shared']);
  });
  it('searches native descriptions and software names without changing identities', () => {
    const models = [
      { id: 'kiro-v3/model%2Fone', label: 'Fast', description: '原软件模型' },
      { id: 'codex/model', label: 'Standard' },
    ];
    expect(groupModels(models, 'KIRO')[0].models[0].id).toBe('kiro-v3/model%2Fone');
    expect(groupModels(models, '原软件')[0].models).toHaveLength(1);
  });
  it('returns an empty result for unmatched or empty catalogs', () => {
    expect(groupModels([], 'Codex')).toEqual([]);
    expect(groupModels([{ id: 'codex/one', label: 'One' }], 'unavailable')).toEqual([]);
  });
});
