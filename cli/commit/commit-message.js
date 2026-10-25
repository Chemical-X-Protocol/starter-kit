/**
 * Chemical X Protocol: the message `chemx commit` hands to git (#2564).
 * Subject: the first -m, with `(#<id>)` added when it has no task reference, then the configured
 * `[skip ci]` when wantsSkipCi says so. Body: the remaining -m paragraphs, a `No-Task:` line when --no-task
 * was used, and a Co-Authored-By trailer only when CHEMX_COAUTHOR or the config names one. No author is
 * ever invented. Config comes from the project's chemx config (`commit` section): { skipCi: boolean, coAuthor: string }.
 */

const TASK_REF = /#(\d+)/;
const SKIP_CI = '[skip ci]';

/**
 * The task id the commit belongs to: --task wins, else the first #<id> in the message. With --no-task the
 * message is never scanned (#6750): a "#12" in its text is prose, not a reference to check or record on.
 */
export const resolveTaskId = (parsed) => {
  const isUnattached = parsed.noTask !== null;
  if (isUnattached) return parsed.taskId;
  const fromMessage = parsed.messages.join('\n').match(TASK_REF);
  const fromText = fromMessage ? fromMessage[1] : null;
  return parsed.taskId ?? fromText;
};

/**
 * Whether the subject gets `[skip ci]`: --no-skip-ci never, --skip-ci always, otherwise commit.skipCi
 * from the config applies only while HEAD is on the default branch (#6750). A tag on a pull request
 * branch would skip the checks that gate its merge.
 */
export const wantsSkipCi = ({ isForced, isSuppressed, config, isDefaultBranch }) => {
  if (isSuppressed) return false;
  if (isForced) return true;
  return Boolean(config?.skipCi) && isDefaultBranch;
};

const withTaskRef = (subject, taskId) => {
  const isTaskNamed = taskId !== null && taskId !== undefined;
  const isRefPresent = subject.includes(`#${taskId}`);
  const needsRef = isTaskNamed && !isRefPresent;
  return needsRef ? `${subject} (#${taskId})` : subject;
};

const withSkipCi = (subject, isEnabled) => {
  const isPresent = subject.includes(SKIP_CI);
  const needsTag = isEnabled && !isPresent;
  return needsTag ? `${subject} ${SKIP_CI}` : subject;
};

/** The co-author line value: CHEMX_COAUTHOR, else config.coAuthor, else null. */
export const resolveCoAuthor = (config, env = process.env) => {
  const fromEnv = (env.CHEMX_COAUTHOR ?? '').trim();
  const fromConfig = String(config?.coAuthor ?? '').trim();
  return fromEnv || fromConfig || null;
};

/**
 * @returns {{ subject: string, paragraphs: string[], coAuthor: string|null }} paragraphs are the -m
 *   arguments for git after the subject.
 */
export const buildCommitMessage = ({ messages, taskId, noTask, config, env, isSkipCi = false }) => {
  const [rawSubject = '', ...bodyParagraphs] = messages;
  const subject = withSkipCi(withTaskRef(rawSubject.trim(), taskId), isSkipCi);
  const coAuthor = resolveCoAuthor(config, env);
  const noTaskLine = noTask ? [`No-Task: ${noTask}`] : [];
  const hasTrailer = Boolean(coAuthor) && !bodyParagraphs.join('\n').includes('Co-Authored-By:');
  const trailer = hasTrailer ? [`Co-Authored-By: ${coAuthor}`] : [];
  return { subject, paragraphs: [...bodyParagraphs, ...noTaskLine, ...trailer], coAuthor };
};
