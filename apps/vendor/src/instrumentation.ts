/**
 * Runs once, before this server answers anything.
 *
 * Next calls `register` in every runtime, so the Node-only work sits behind a check and is imported
 * lazily — the edge runtime has neither these environment variables nor `node:crypto`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertSecrets, InsecureDeploymentError } = await import('./lib/boot');
  try {
    assertSecrets();
  } catch (e) {
    if (!(e instanceof InsecureDeploymentError)) throw e;

    /*
      Exit, rather than let the error propagate.

      A thrown error here leaves Next listening and answering 500 to every request. That fails
      closed, which is right, but it reads to an orchestrator as a server that started and to a
      person as an outage with no cause — and the reason scrolls past in a stack trace three times.
      Exiting non-zero is the honest report: the deployment is misconfigured, and nothing about it
      is going to work until somebody fixes it.
    */
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }
}
