import { createInterface } from 'node:readline';
import { ReferenceRepository } from './references';
import { BasketRepository } from './basket';
import { probeCodex } from './codex-target';

// Local, on-demand child process: persistence and hashing never run in Tabby's renderer.
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
input.on('line', line => {
  chain = chain.then(async () => {
    let request: any;
    try {
      if (line.length > 14 * 1024 * 1024) throw new Error('请求过大');
      request = JSON.parse(line);
      if (request.method === 'codex-probe') {
        const result = await probeCodex(request.root_pid);
        process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
        return;
      }
      const repository = await ReferenceRepository.forWorkspace(request.workspace, request.method === 'create' || ['basket-add', 'basket-update'].includes(request.method));
      const basket = new BasketRepository(repository);
      let result;
      switch (request.method) {
        case 'create': result = await repository.create(request.text, request.source); break;
        case 'list': result = await repository.list(request.limit, request.before); break;
        case 'copy': result = await repository.copy(request.reference_id); break;
        case 'read': result = await repository.read(request.reference_id, request.offset, request.max_characters); break;
        case 'basket-view': result = await basket.view(); break;
        case 'basket-add': result = await basket.add(request.text, request.source); break;
        case 'basket-update': result = await basket.update(request.action, request.reference_id, request.note, request.revision); break;
        case 'basket-copy': result = await basket.copy(request.revision); break;
        default: throw new Error('不支持的引用操作');
      }
      process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
    } catch (error) { process.stdout.write(JSON.stringify({ id: request?.id, error: String(error) }) + '\n'); }
  });
});
input.on('close', () => { void chain.then(() => process.exit(0)); });
