import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startLobby, serverData } from './local-lobby.mjs';

async function post(url, path, body) {
  const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('upstream guest session survives SQLite reopen and releases its name on logout', async () => {
  await mkdir(serverData, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(serverData, 'lobby-test-'));
  let lobby;
  try {
    const options = { port: 0, database: join(directory, 'lobby.sqlite') };
    lobby = await startLobby(options);
    const guest = { nickname: 'LocalTest', protocol: 4 };
    const created = await post(lobby.url, '/v1/sessions', guest);
    assert.equal(created.status, 200);
    assert.equal(created.body.nickname, guest.nickname);
    assert.equal(typeof created.body.token, 'string');
    await lobby.close(); lobby = null;
    lobby = await startLobby(options);
    assert.equal((await post(lobby.url, '/v1/sessions', guest)).status, 409);
    const headers = { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' };
    const channels = await fetch(lobby.url + '/v1/channels?kind=0', { headers });
    assert.equal(channels.status, 200);
    const logout = await fetch(lobby.url + '/v1/commands', { method: 'POST', headers,
      body: JSON.stringify({ request_id: '1', after: 0, operation: 'logout', payload: {} }) });
    assert.equal(logout.status, 200);
    assert.equal((await post(lobby.url, '/v1/sessions', guest)).status, 200);
    assert.equal((await post(lobby.url, '/v1/sessions', { ...guest, password: 'old-format' })).status, 426);
  } finally { if (lobby) await lobby.close(); await rm(directory, { recursive: true }); }
});

test('real HTTP adapter retains upstream request size limit', async () => {
  const lobby = await startLobby({ port: 0, database: join(serverData, `limit-test-${process.pid}.sqlite`) });
  try {
    const response = await post(lobby.url, '/v1/accounts', { padding: 'x'.repeat(65537) });
    assert.equal(response.status, 413);
  } finally {
    await lobby.close();
    for (const suffix of ['', '-wal', '-shm']) await rm(join(serverData, `limit-test-${process.pid}.sqlite${suffix}`), { force: true });
  }
});
