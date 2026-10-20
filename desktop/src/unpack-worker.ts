// The worker thread for bases.ts: identifying a download in the library, or
// unpacking it into the cache, off the main thread so the window stays
// responsive (Long War's installer takes some seconds to unpack).

import { parentPort, workerData } from 'node:worker_threads'
import { identifyBase, unpackInto, type Task } from './bases'

async function run(job: Task) {
  if (job.task === 'identify') return identifyBase(job.library, job.source, job.file)
  await unpackInto(job.found, job.source, job.tmp, (done, total) =>
    parentPort!.postMessage({ progress: [done, total] }),
  )
  return undefined
}

run(workerData as Task).then(
  (result) => parentPort!.postMessage({ done: true, result }),
  (e: Error) => parentPort!.postMessage({ error: e.message }),
)
