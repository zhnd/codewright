'use client';

import { FormErrorAlert } from '@/components/common/form-error-alert';
import { SectionHead } from '@/components/common/section-head';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AUTH_PROVIDER_LABELS,
  AUTH_PROVIDER_TOKEN_PLACEHOLDERS,
  AUTH_PROVIDER_URL_PLACEHOLDERS,
  AUTH_PROVIDERS,
  type AuthProviderValue,
  type ProjectFormValues,
} from './libs';
import { useService } from './use-service';

interface ProjectFormProps {
  mode: 'create' | 'edit';
  projectId?: string;
  defaultValues?: Partial<ProjectFormValues>;
}

const labelClass =
  'text-[11.5px] font-medium uppercase tracking-[0.04em] text-foreground-subtle';

export function ProjectForm({
  mode,
  projectId,
  defaultValues,
}: ProjectFormProps) {
  const { form, error, isLoading, onSubmit } = useService({
    mode,
    projectId,
    defaultValues,
  });

  const provider: AuthProviderValue = form.watch('authProvider') ?? 'GITHUB';
  const providerLabel = AUTH_PROVIDER_LABELS[provider];

  const submitLabel = isLoading
    ? mode === 'create'
      ? 'Connecting…'
      : 'Saving…'
    : mode === 'create'
      ? 'Connect repository'
      : 'Save changes';

  return (
    <div>
      <FormErrorAlert message={error} />

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-7"
        >
          {/* Basics */}
          <section>
            <SectionHead
              title="Repository"
              subtitle="What Torin will analyze and patch"
            />
            <div className="rounded-md border border-border bg-surface p-5">
              <div className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>Project name</FormLabel>
                      <FormControl>
                        <Input placeholder="acme-billing" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="authProvider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>Git host</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {AUTH_PROVIDERS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {AUTH_PROVIDER_LABELS[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="repositoryUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>
                        Repository URL
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={AUTH_PROVIDER_URL_PLACEHOLDERS[provider]}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="credentials"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>
                        {providerLabel} access token
                        <span className="ml-1 font-normal normal-case tracking-normal text-foreground-subtle">
                          — optional
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={
                            AUTH_PROVIDER_TOKEN_PLACEHOLDERS[provider]
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="npmrc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>
                        .npmrc
                        <span className="ml-1 font-normal normal-case tracking-normal text-foreground-subtle">
                          — optional, for private package registries
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          rows={6}
                          spellCheck={false}
                          className="font-mono text-[12px]"
                          placeholder={`//npm.cnb.cool/:_authToken=\${TORIN_GIT_TOKEN}\n@scope:registry=https://npm.cnb.cool/group/npm/registry/`}
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <p className="mt-1 text-[11px] leading-snug text-foreground-subtle">
                        Use{' '}
                        <code className="rounded bg-surface-2 px-1 font-mono text-[10.5px]">
                          {'${TORIN_GIT_TOKEN}'}
                        </code>{' '}
                        to reference the access token without writing it to
                        disk. Pasting a literal token bakes it into the sandbox
                        image.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </section>

          {/* Preview */}
          <section>
            <SectionHead
              title="Preview"
              subtitle="Boot-verify dev server during FILTER · leave blank for non-web projects"
            />
            <div className="rounded-md border border-border bg-surface p-5">
              <div className="flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="previewCommand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>
                        Dev server command
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="pnpm dev" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="previewPort"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>Port</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="3000"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="previewReadyPattern"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>
                        Ready log pattern
                        <span className="ml-1 font-normal normal-case tracking-normal text-foreground-subtle">
                          — optional
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="ready in" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
