/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  assistantToOption,
  filterTeamSupportedAssistants,
  assistantKey,
  teamModelOptions,
} from '@/renderer/pages/team/components/assistantSelectUtils';
import type { Assistant } from '@/common/types/agent/assistantTypes';

describe('assistantSelectUtils', () => {
  it('localizes assistant option names for the active locale', () => {
    const bareAssistant = makeAssistant({
      id: 'bare-aionrs',
      name: 'Aion CLI',
      name_i18n: { 'zh-CN': 'Aion 命令行' },
      source: 'generated',
      preset_agent_type: 'aionrs',
    });

    const option = assistantToOption(bareAssistant, 'zh-CN');

    expect(option.name).toBe('Aion 命令行');
  });

  it('preserves backend-provided team availability for selectable assistants', () => {
    const remoteAssistant = makeAssistant({
      id: 'bare-remote',
      name: 'Remote Runner',
      source: 'generated',
      preset_agent_type: 'remote',
      team_selectable: true,
      team_block_reason: undefined,
    });

    const [option] = filterTeamSupportedAssistants([assistantToOption(remoteAssistant)]);

    expect(option.team_selectable).toBe(true);
    expect(option.team_block_reason).toBeUndefined();
  });

  it('keeps unchecked assistants selectable when backend projection allows team use', () => {
    const assistant = makeAssistant({
      id: 'unchecked',
      name: 'Unchecked',
      source: 'generated',
      preset_agent_type: 'aionrs',
      agent_status: 'unchecked',
      team_selectable: true,
    });

    const option = assistantToOption(assistant);

    expect(option.team_selectable).toBe(true);
  });

  it('keeps different AI models on one connection independently selectable', () => {
    const connection = {
      ...makeAssistant({ id: 'local-codex', name: 'Codex', source: 'generated', preset_agent_type: 'acp' }),
      provider: 'codex',
    };
    const options = teamModelOptions(
      [connection],
      {
        models: [
          { id: 'codex/first', label: 'First AI', provider: 'codex' },
          { id: 'codex/second', label: 'Second AI', provider: 'codex' },
        ],
        errors: [],
      },
      'en-US'
    );
    expect(options.map((o) => [o.id, o.model])).toEqual([
      ['local-codex', 'codex/first'],
      ['local-codex', 'codex/second'],
    ]);
    expect(new Set(options.map(assistantKey)).size).toBe(2);
  });

  it('does not advertise an AI without a registered execution connection', () => {
    expect(
      teamModelOptions(
        [],
        { models: [{ id: 'codex/first', label: 'First AI', provider: 'codex' }], errors: [] },
        'en-US'
      )
    ).toEqual([]);
  });
});

function makeAssistant(
  overrides: Partial<Assistant> & Pick<Assistant, 'id' | 'name' | 'source' | 'preset_agent_type'>
): Assistant {
  return {
    id: overrides.id,
    source: overrides.source,
    name: overrides.name,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    preset_agent_type: overrides.preset_agent_type,
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    avatar: undefined,
    agent_status: 'online',
    team_selectable: true,
    team_block_reason: undefined,
    deletable: false,
    ...overrides,
  };
}
