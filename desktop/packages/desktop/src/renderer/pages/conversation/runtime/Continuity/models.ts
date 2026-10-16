// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
export const providerName = (id?: string | null): string =>
  ({ codex: 'Codex', 'kiro-v3': 'Kiro V3', kiro: 'Kiro', zcode: 'ZCode' })[id || ''] || id || '';

export type ModelChoice = { id: string; label: string; description?: string };

/** Keep native composite identities intact; labels are presentation only. */
export function groupModels(
  models: ModelChoice[],
  query: string
): Array<{ provider: string; name: string; models: ModelChoice[] }> {
  const result = new Map<string, ModelChoice[]>(),
    needle = query.trim().toLocaleLowerCase();
  for (const model of models) {
    const provider = model.id.includes('/') ? model.id.slice(0, model.id.indexOf('/')) : '';
    if (
      needle &&
      ![providerName(provider), model.label, model.id, model.description || '']
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    )
      continue;
    result.set(provider, [...(result.get(provider) || []), model]);
  }
  return [...result].map(([provider, choices]) => ({ provider, name: providerName(provider), models: choices }));
}
