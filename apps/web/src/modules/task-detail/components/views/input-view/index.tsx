import { Markdown } from '@/components/common/markdown';
import { type MediaItem, parseTaskInput } from '@/modules/tasks/transform';
import type { TaskDetail } from '../../../types';
import { Section } from '../../stage-body/parts';

interface InputViewProps {
  detail: TaskDetail;
}

/**
 * "Input" tab — the original request that kicked off the task. Renders the
 * human-authored description (markdown), the remaining scalar fields, and
 * any attached media. Media fields are a forward-compatible convention; no
 * backend writes them yet, so those sections stay hidden until they exist.
 */
export function InputView({ detail }: InputViewProps) {
  const { body, fields, images, videos, attachments } = parseTaskInput(
    detail.task.input
  );

  const hasMedia =
    images.length > 0 || videos.length > 0 || attachments.length > 0;

  if (!body && fields.length === 0 && !hasMedia) {
    return (
      <div className="rounded-md border border-border-faint bg-surface-2 px-4 py-10 text-center text-[13px] text-foreground-muted">
        No input was recorded for this task.
      </div>
    );
  }

  return (
    <div className="pb-12">
      {body && (
        <Section label="Request">
          <Markdown>{body}</Markdown>
        </Section>
      )}

      {fields.length > 0 && (
        <Section label="Details">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[13px]">
            {fields.map((f) => (
              <div key={f.key} className="contents">
                <dt className="font-mono text-[11.5px] uppercase tracking-[0.04em] text-foreground-subtle">
                  {f.key}
                </dt>
                <dd className="m-0 break-words font-mono text-foreground">
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {images.length > 0 && (
        <Section label="Images">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((img) => (
              <a
                key={img.url}
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block overflow-hidden rounded-md border border-border-faint bg-surface-inset"
              >
                {/* biome-ignore lint/performance/noImgElement: user-supplied external URLs, not local assets */}
                <img
                  src={img.url}
                  alt={img.label ?? 'Task input image'}
                  className="aspect-video w-full object-cover transition-opacity group-hover:opacity-90"
                />
                {img.label && (
                  <div className="truncate px-2 py-1.5 text-[11px] text-foreground-muted">
                    {img.label}
                  </div>
                )}
              </a>
            ))}
          </div>
        </Section>
      )}

      {videos.length > 0 && (
        <Section label="Videos">
          <div className="flex flex-col gap-3">
            {videos.map((v) => (
              <div
                key={v.url}
                className="overflow-hidden rounded-md border border-border-faint bg-surface-inset"
              >
                {/* biome-ignore lint/a11y/useMediaCaption: user-supplied media, no caption track available */}
                <video src={v.url} controls className="w-full" />
                {v.label && (
                  <div className="px-2.5 py-1.5 text-[11.5px] text-foreground-muted">
                    {v.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {attachments.length > 0 && (
        <Section label="Attachments">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {attachments.map((a) => (
              <AttachmentRow key={a.url} item={a} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function AttachmentRow({ item }: { item: MediaItem }) {
  let name = item.label;
  if (!name) {
    try {
      name = decodeURIComponent(
        new URL(item.url).pathname.split('/').pop() ?? ''
      );
    } catch {
      name = item.url;
    }
  }
  return (
    <li>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-sm border border-border-faint bg-surface-2 px-2.5 py-1.5 text-[13px] text-foreground hover:bg-surface-inset"
      >
        <span className="truncate font-mono text-[12px]">
          {name || item.url}
        </span>
      </a>
    </li>
  );
}
