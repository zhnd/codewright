import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';

export async function destroySandboxActivity(
  state: SandboxState
): Promise<void> {
  log.info({ containerId: getContainerId(state) }, 'Destroying sandbox');
  const sandbox = await connectSandbox(state);
  await sandbox.stop();
  log.info({ containerId: getContainerId(state) }, 'Sandbox destroyed');
}

function getContainerId(state: SandboxState): string {
  return state.provider === 'docker' ? state.containerId : 'unknown';
}
