/**
 * Chemical X Protocol: the message `chemx commit` hands to git (#2564).
 * Subject: the first -m, with `(#<id>)` added when it has no task reference, then the configured
 * `[skip ci]`. Body: the remaining -m paragraphs, a `No-Task:` line when --no-task was used, and a
 * Co-Authored-By trailer only when CHEMX_COAUTHOR or the config names one. No author is ever invented.
 * Config comes from the project's chemx config (`commit` section): { skipCi: boolean, coAuthor: string }.
 */

const TASK_REF = /#(\d+)/;
const SKIP_CI = '[skip ci]';

/** The task id the commit belongs to: --task wins, else the first #<id> in the message. */
export const resolveTaskId = (parsed) => {
  const fromMessage = parsed.messages.join('\n').match(TASK_REF);
  const fromText = fromMessage ? fromMessage[1] : null;
  return parsed.taskId ?? fromText;
};

const withTaskRef = (subject, taskId) => {
  const isTaskNamed = taskId !== null && taskId !== undefined;
  const isRefPresent = subject.includes(`#${taskId}`);
  const needsRef = isTaskNamed && !isRefPresent;
  return needsRef ? `${subject} (#${taskId})` : subject;
};

const withSkipCi = (subject, config) => {
  const isEnabled = Boolean(config?.skipCi);
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
export const buildCommitMessage = ({ messages, taskId, noTask, config, env }) => {
  const [rawSubject = '', ...bodyParagraphs] = messages;
  const subject = withSkipCi(withTaskRef(rawSubject.trim(), taskId), config);
  const coAuthor = resolveCoAuthor(config, env);
  const noTaskLine = noTask ? [`No-Task: ${noTask}`] : [];
  const hasTrailer = Boolean(coAuthor) && !bodyParagraphs.join('\n').includes('Co-Authored-By:');
  const trailer = hasTrailer ? [`Co-Authored-By: ${coAuthor}`] : [];
  return { subject, paragraphs: [...bodyParagraphs, ...noTaskLine, ...trailer], coAuthor };
};
