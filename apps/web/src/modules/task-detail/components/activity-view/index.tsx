'use client';

import {
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderTreeIcon,
  type LucideIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';
import type { BundledLanguage } from 'shiki';
import { CodeBlockContent } from '@/components/ai-elements/code-block';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { StageTimingView } from '@/modules/tasks/types';
import { TAB_CONTENT_WIDTH, TAB_SCROLL_PADDING } from '../../constants';
import { StageNav } from './components/stage-nav';
import { fileLang, formatBytes, formatInputJson, isMarkdownPath } from './libs';
import type { SectionItem, WorkStep } from './types';
import { useService } from './use-service';

/** Workflows with a fixed multi-stage pipeline always show the rail, even
 *  before later stages have produced events. Single-stage workflows
 *  (analyze-repository) render the stream full-width. */
const MULTI_STAGE_WORKFLOWS = new Set(['RESOLVE_DEFECT']);

interface ActivityViewProps {
  taskId: string;
  /** From the control plane — drives live subscription + "working" cue. */
  isRunning: boolean;
  /** Task workflow type — decides whether the stage rail is shown. */
  workflow: string;
  /** Stage attempts (eventId/stageKey/attemptNumber/status) for the rail. */
  stages: StageTimingView[];
}

/** Map a clean tool name to an icon (best-effort, falls back to wrench). */
function toolIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes('read')) return FileTextIcon;
  if (n.includes('list') || n.includes('glob') || n.includes('tree'))
    return FolderTreeIcon;
  if (n.includes('grep') || n.includes('search') || n.includes('find'))
    return SearchIcon;
  if (
    n.includes('bash') ||
    n.includes('shell') ||
    n.includes('exec') ||
    n.includes('run')
  )
    return TerminalIcon;
  if (n.includes('write') || n.includes('edit') || n.includes('patch'))
    return PencilIcon;
  return WrenchIcon;
}

export function ActivityView({
  taskId,
  isRunning,
  workflow,
  stages,
}: ActivityViewProps) {
  const {
    rail,
    selectedEventId,
    selectEvent,
    selectedItems,
    selectedMeta,
    loading,
    hasMore,
    loadMore,
    hasRows,
  } = useService({ taskId, isRunning, stages });

  // Show the rail for fixed multi-stage pipelines (resolve-defect) from the
  // start — so the stages are visible before later ones run — or once the
  // data itself proves it's multi-stage / multi-round.
  const showRail =
    MULTI_STAGE_WORKFLOWS.has(workflow) ||
    rail.length > 1 ||
    rail.some((s) => s.rounds.length > 1);

  const stream = (
    <div className="flex min-h-0 flex-1 flex-col">
      {showRail && selectedMeta && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-faint px-4 py-2 sm:px-6 lg:px-8">
          <span className="text-[13px] font-semibold text-foreground">
            {selectedMeta.label}
          </span>
          {selectedMeta.roundCount > 1 && (
            <span className="rounded-sm bg-surface-2 px-1.5 py-px font-mono text-[10px] text-foreground-muted">
              round {selectedMeta.attemptNumber}
            </span>
          )}
          {selectedMeta.stepCount > 0 && (
            <span className="ml-auto font-mono text-[10.5px] text-foreground-subtle">
              {selectedMeta.stepCount} steps
            </span>
          )}
        </div>
      )}

      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={`${TAB_CONTENT_WIDTH} ${TAB_SCROLL_PADDING} gap-3`}
        >
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              className="self-start rounded-sm border border-border-faint px-2.5 py-1 text-[11px] text-foreground-muted hover:bg-surface-2"
            >
              Load earlier
            </button>
          )}
          {selectedItems.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
          {selectedItems.length === 0 && !loading && (
            <div className="py-12 text-center text-[12px] text-foreground-subtle">
              {!hasRows && isRunning
                ? 'Waiting for the agent to start…'
                : 'No agent activity for this stage.'}
            </div>
          )}
          {isRunning && selectedItems.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-foreground-subtle">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)]" />
              Agent working…
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showRail ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_1fr]">
          {/* Left rail: stages / rounds */}
          <div className="max-h-56 overflow-y-auto border-b border-border-faint bg-surface-cream/30 p-3 lg:max-h-none lg:border-r lg:border-b-0">
            <div className="flex items-center gap-1.5 px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
              <span className="inline-block h-1 w-1 rounded-full bg-foreground-faint" />
              Stages
            </div>
            <StageNav
              rail={rail}
              selectedEventId={selectedEventId}
              onSelect={selectEvent}
            />
          </div>
          {stream}
        </div>
      ) : (
        stream
      )}
    </div>
  );
}

function ItemRow({ item }: { item: SectionItem }) {
  if (item.kind === 'message') {
    return (
      <Message from={item.role} className="max-w-full">
        <MessageContent>
          {item.role === 'assistant' ? (
            <MessageResponse>{item.text}</MessageResponse>
          ) : (
            <span className="whitespace-pre-wrap">{item.text}</span>
          )}
        </MessageContent>
      </Message>
    );
  }
  if (item.kind === 'error') {
    return (
      <div className="rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/10 px-3 py-2 text-[12px] text-[color:var(--danger)]">
        {item.text}
      </div>
    );
  }
  return <StepRow step={item.step} />;
}

function StatusGlyph({ status }: { status: WorkStep['status'] }) {
  if (status === 'error')
    return <XIcon className="size-3 text-[color:var(--danger)]" />;
  if (status === 'active')
    return (
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)]" />
    );
  return <CheckIcon className="size-3 text-ok" />;
}

function StepRow({ step }: { step: WorkStep }) {
  // Reasoning — markdown, not expandable.
  if (step.type === 'reasoning') {
    return (
      <div className="flex gap-2.5">
        <BrainIcon className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle" />
        <div className="min-w-0 flex-1 text-[12.5px] leading-[1.55] text-foreground-muted">
          <MessageResponse>{step.detail ?? ''}</MessageResponse>
        </div>
      </div>
    );
  }

  const Icon = toolIcon(step.title);
  const isError = step.status === 'error';
  const expandable = step.input != null || step.output != null;

  const head = (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px]">
      <Icon className="size-3.5 shrink-0 text-foreground-subtle" />
      <span
        className={`shrink-0 font-medium ${isError ? 'text-[color:var(--danger)]' : 'text-foreground'}`}
      >
        {step.title}
      </span>
      {step.detail && (
        <span className="truncate font-mono text-[11px] text-foreground-subtle">
          {step.detail}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <StatusGlyph status={step.status} />
        {expandable && (
          <ChevronRightIcon className="size-3.5 text-foreground-faint transition-transform group-data-[state=open]:rotate-90" />
        )}
      </span>
    </div>
  );

  if (!expandable) {
    return <div className="flex gap-2.5">{head}</div>;
  }

  return (
    <Collapsible className="group flex gap-2.5">
      <div className="min-w-0 flex-1">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 text-left">
          {head}
        </CollapsibleTrigger>
        {step.preview && (
          <div className="mt-0.5 line-clamp-1 pl-5.5 font-mono text-[11px] text-foreground-subtle group-data-[state=open]:hidden">
            {step.preview}
          </div>
        )}
        <CollapsibleContent className="mt-1.5 space-y-2 pl-5.5">
          {step.input != null && (
            <IoBlock
              label="input"
              body={formatInputJson(step.input)}
              language="json"
            />
          )}
          {step.output != null && step.output !== '' && (
            <IoBlock
              label={isError ? 'error' : 'output'}
              body={step.output}
              truncatedAt={step.outputTruncatedAt}
              danger={isError}
              markdown={!isError && isMarkdownPath(step.detail)}
              language={isError ? null : fileLang(step.detail)}
            />
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function IoBlock({
  label,
  body,
  truncatedAt,
  danger,
  language,
  markdown,
}: {
  label: string;
  body: string;
  truncatedAt?: number | null;
  danger?: boolean;
  /** Shiki language for syntax highlighting; null/undefined → plain text. */
  language?: BundledLanguage | null;
  /** Render the body as rendered Markdown instead of code. */
  markdown?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-(--radius-sm) border border-border-faint bg-surface-inset">
      <div className="flex items-center gap-2 border-border-faint border-b px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-foreground-subtle">
        {language && !markdown ? language : label}
        {truncatedAt != null && (
          <span className="text-foreground-faint">
            truncated · {formatBytes(truncatedAt)} total
          </span>
        )}
      </div>
      {markdown ? (
        <div className="max-h-96 overflow-auto px-3 py-2 text-[12.5px] leading-[1.55]">
          <MessageResponse>{body}</MessageResponse>
        </div>
      ) : language ? (
        <div className="max-h-96 overflow-auto text-[11px] leading-[1.5] [&_pre]:!bg-transparent [&_pre]:!px-2.5 [&_pre]:!py-2 [&_pre]:!text-[11px]">
          <CodeBlockContent code={body} language={language} />
        </div>
      ) : (
        <pre
          className={`m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[11px] leading-[1.5] ${danger ? 'text-danger' : 'text-foreground-muted'}`}
        >
          {body}
        </pre>
      )}
    </div>
  );
}
