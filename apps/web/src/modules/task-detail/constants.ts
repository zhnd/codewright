import type { DetailTab, StageKey } from './types';

export const STAGE_LABELS: Record<StageKey, string> = {
  analyze: 'Analysis',
  reproduce: 'Reproduction',
  implement: 'Implementation',
  filter: 'Filter',
  critic: 'Critic review',
  hitl: 'Human review',
  pr: 'Pull request',
} as const;

export const STAGE_ORDER: StageKey[] = [
  'analyze',
  'reproduce',
  'implement',
  'filter',
  'critic',
  'hitl',
  'pr',
];

export const DETAIL_TABS: [DetailTab, string][] = [
  ['overview', 'Overview'],
  ['input', 'Input'],
  ['activity', 'Activity'],
  ['timeline', 'Timeline'],
];

/**
 * Shared content metrics for every detail tab. Keeping the scroll padding and
 * the centered max-width identical across Overview / Activity / Visual stops
 * the content box from changing width when switching tabs.
 */
export const TAB_SCROLL_PADDING = 'px-4 py-5 sm:px-6 lg:px-8 lg:py-6';
export const TAB_CONTENT_WIDTH = 'mx-auto w-full max-w-260';
