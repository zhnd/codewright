import { useMutation } from '@apollo/client/react';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { CREATE_PROJECT, UPDATE_PROJECT } from '@/modules/projects/graphql';
import { type ProjectFormValues, projectSchema } from './libs';

interface UseServiceOptions {
  mode: 'create' | 'edit';
  projectId?: string;
  defaultValues?: Partial<ProjectFormValues>;
}

export function useService({
  mode,
  projectId,
  defaultValues,
}: UseServiceOptions) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ProjectFormValues>({
    resolver: standardSchemaResolver(projectSchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      repositoryUrl: defaultValues?.repositoryUrl ?? '',
      authProvider: defaultValues?.authProvider ?? 'GITHUB',
      npmrc: '',
      previewCommand: defaultValues?.previewCommand ?? '',
      previewPort: defaultValues?.previewPort ?? '',
      previewReadyPattern: defaultValues?.previewReadyPattern ?? '',
    },
  });

  const [createProject, { loading: creating }] = useMutation<{
    createProject?: { id: string } | null;
  }>(CREATE_PROJECT);
  const [updateProject, { loading: updating }] = useMutation(UPDATE_PROJECT);
  const isLoading = creating || updating;

  async function onSubmit(values: ProjectFormValues) {
    setError(null);
    try {
      const credentials = values.credentials || undefined;
      const previewCommand = values.previewCommand?.trim() || undefined;
      const previewReadyPattern =
        values.previewReadyPattern?.trim() || undefined;
      const previewPort = values.previewPort
        ? Number(values.previewPort)
        : undefined;
      // npmrc semantics: undefined = don't touch in update; '' = explicit clear;
      // non-empty = upsert. In create mode we always send a value (omit if empty
      // so the server doesn't write `{secrets:{}}`).
      const npmrcRaw = values.npmrc;
      const npmrc =
        mode === 'edit'
          ? (npmrcRaw ?? undefined)
          : npmrcRaw && npmrcRaw.length > 0
            ? npmrcRaw
            : undefined;
      const payload = {
        name: values.name,
        repositoryUrl: values.repositoryUrl,
        authProvider: values.authProvider,
        credentials,
        npmrc,
        previewCommand,
        previewPort,
        previewReadyPattern,
      };
      if (mode === 'create') {
        const { data } = await createProject({ variables: payload });
        if (data?.createProject?.id) {
          toast.success('Project created');
          router.push(`/projects/${data.createProject.id}`);
        }
      } else if (projectId) {
        await updateProject({
          variables: { id: projectId, ...payload },
        });
        toast.success('Project updated');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Operation failed';
      setError(message);
    }
  }

  return { form, error, isLoading, onSubmit };
}
