#!/usr/bin/env node
// Block until the infra services that server/worker depend on accept TCP
// connections. Used by mprocs.yaml to gate the app procs behind docker, since
// mprocs starts every proc at once and has no dependency ordering of its own.
//
// Ports mirror docker-compose.yml (POSTGRES_PORT defaults to 5432, Temporal
// is fixed at 7233). Override via env when running a non-default setup.
import net from 'node:net';

const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS) || 120_000;
const POLL_MS = 500;

const targets = [
  {
    name: 'postgres',
    host: 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
  },
  {
    name: 'temporal',
    host: 'localhost',
    port: Number(process.env.TEMPORAL_PORT) || 7233,
  },
];

function probe({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

async function waitFor(target) {
  const deadline = Date.now() + TIMEOUT_MS;
  process.stdout.write(`⏳ waiting for ${target.name} :${target.port} ...\n`);
  while (Date.now() < deadline) {
    if (await probe(target)) {
      process.stdout.write(`✓ ${target.name} ready\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  process.stderr.write(
    `✗ ${target.name} not reachable after ${TIMEOUT_MS / 1000}s — is docker up?\n`
  );
  process.exit(1);
}

for (const target of targets) {
  await waitFor(target);
}
