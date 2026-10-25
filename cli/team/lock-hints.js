/**
 * The one sentence a refused editor needs (#6748): who holds the file and the exact commands to get it.
 * Shared by the native Edit/Write hook (hooks/native-edit-lock.js) and the chemx patch/write refusal
 * (team/write-lock-guard.js). The holder releases the lease, or hands over the task whose id is its purpose
 * (`--with-locks` moves the leases naming that task); the editor then acquires it. Nothing here moves a lock.
 */

const TASK_PURPOSE = /^#(\d+)$/;

export const takeoverHint = ({ file, holder, purpose, actor }) => {
  const task = TASK_PURPOSE.exec(purpose ?? '');
  const handoff = task ? ` or hand the task over: \`chemx team task handoff ${task[1]} ${actor} --with-locks --as=${holder}\`` : '';
  return `ask ${holder} to run \`chemx team lock release ${file} --as=${holder}\`${handoff}, or wait for the expiry, then \`chemx team lock acquire ${file} --as=${actor}\`.`;
};
