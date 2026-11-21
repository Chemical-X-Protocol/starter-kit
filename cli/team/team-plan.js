/**
 * `chemx team task plan <parentId> --file=<json>`: a planner breaks a deep task into children that cheaper
 * tiers can build (#7693). validatePlan is pure and refuses a plan whose children cannot run in parallel or
 * do not add up to the parent. The command is a dry run by default; --apply creates the children.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createTask, getTask } from './team-db.js';
import { FIBONACCI, setPoints } from './team-points.js';

const MAX_CHILD_POINTS = 5;

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

const labelOf = (child, index) => `Child ${index + 1} "${child?.title || '(untitled)'}"`;

const pointsErrors = (child, label) => {
  const points = Number(child?.points);
  const isFibonacci = FIBONACCI.includes(points);
  const isSmallEnough = points <= MAX_CHILD_POINTS;
  const isValid = isFibonacci && isSmallEnough;
  if (isValid) return [];
  return [`${label}: points must be one of ${FIBONACCI.filter((n) => n <= MAX_CHILD_POINTS).join(', ')}; got "${child?.points}".`];
};

const acceptanceErrors = (child, label) => {
  const hasAcceptance = hasText(child?.acceptance);
  if (hasAcceptance) return [];
  return [`${label}: has no acceptance spec path.`];
};

const filesOf = (child) => (Array.isArray(child?.files) ? child.files.filter(hasText).map((file) => file.trim()) : []);

const filesErrors = (child, label) => {
  const hasFiles = filesOf(child).length > 0;
  if (hasFiles) return [];
  return [`${label}: has no files.`];
};

// createTask makes nothing without a title, so --apply could not create an untitled child.
const titleErrors = (child, label) => {
  const hasTitle = hasText(child?.title);
  if (hasTitle) return [];
  return [`${label}: has no title.`];
};

const childErrors = (child, index) => {
  const label = labelOf(child, index);
  return [...titleErrors(child, label), ...pointsErrors(child, label), ...acceptanceErrors(child, label), ...filesErrors(child, label)];
};

const sumErrors = (parentPoints, children) => {
  const hasParentPoints = parentPoints !== null && parentPoints !== undefined;
  if (!hasParentPoints) return [];
  const parent = Number(parentPoints);
  const sum = children.reduce((total, child) => total + (Number(child?.points) || 0), 0);
  const isTooHigh = sum > parent * 2;
  const isTooLow = sum < parent / 2;
  const isOutOfRange = isTooHigh || isTooLow;
  if (!isOutOfRange) return [];
  return [`Child points sum to ${sum}; the parent is ${parent}, so the sum must be between ${parent / 2} and ${parent * 2}.`];
};

const sharedFileErrors = (children) => {
  const owners = new Map();
  children.forEach((child, index) => {
    for (const file of new Set(filesOf(child))) owners.set(file, [...(owners.get(file) || []), index + 1]);
  });
  const shared = [...owners].filter(([, indexes]) => indexes.length > 1);
  return shared.map(([file, indexes]) => `File ${file} is shared by children ${indexes.join(' and ')}; children that share a file cannot run in parallel.`);
};

/**
 * Pure: checks a plan without touching any board.
 * @param {{ parentPoints: number|null, children: Array<{ title: string, points: number, needs: string, files: string[], acceptance: string }> }} plan
 * @returns {{ errors: string[] }}
 */
export const validatePlan = ({ parentPoints = null, children } = {}) => {
  const list = Array.isArray(children) ? children : [];
  const hasChildren = list.length > 0;
  if (!hasChildren) return { errors: ['The plan has no children.'] };
  const errors = [...list.flatMap(childErrors), ...sumErrors(parentPoints, list), ...sharedFileErrors(list)];
  return { errors };
};

const readChildren = (file, cwd) => {
  const hasFile = hasText(file);
  if (!hasFile) return { error: 'Usage: chemx team task plan <parentId> --file=<json> [--apply]' };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(cwd, file), 'utf8'));
    const isArray = Array.isArray(parsed);
    if (!isArray) return { error: `Plan file ${file} must hold a JSON array of children.` };
    return { children: parsed };
  } catch (err) {
    return { error: `Plan file ${file} could not be read: ${err.message}` };
  }
};

const parentPointsOf = (db, parentId) => db.prepare('SELECT points FROM agent_tasks WHERE id = ?').get(Number(parentId))?.points ?? null;

const describeChild = (child) => `Files: ${filesOf(child).join(', ')}\nAcceptance: ${child.acceptance.trim()}`;

const createChild = (db, parent, child) => {
  const task = createTask(db, { title: child.title, description: describeChild(child), needs: child.needs, parent_id: parent.id, repo: parent.repo });
  setPoints(db, task.id, child.points);
  return { ...task, points: Number(child.points) };
};

/**
 * Reads the plan file, validates it against the parent's points, and creates the children only when apply is set.
 * @returns {{ error: string, errors?: string[] } | { parentId: number, parentPoints: number|null, applied: boolean, children: object[], created: object[] }}
 */
export const planTask = (db, parentId, { file, cwd = process.cwd(), apply = false } = {}) => {
  const parent = parentId ? getTask(db, parentId) : null;
  const hasParent = Boolean(parent);
  if (!hasParent) return { error: `Parent task #${parentId ?? '(none)'} not found. Usage: chemx team task plan <parentId> --file=<json> [--apply]` };
  const read = readChildren(file, cwd);
  const isUnreadable = Boolean(read.error);
  if (isUnreadable) return { error: read.error };
  const parentPoints = parentPointsOf(db, parent.id);
  const { errors } = validatePlan({ parentPoints, children: read.children });
  const isInvalid = errors.length > 0;
  if (isInvalid) return { error: `Plan for #${parent.id} refused:\n  ${errors.join('\n  ')}`, errors };
  const created = apply ? read.children.map((child) => createChild(db, parent, child)) : [];
  return { parentId: parent.id, parentPoints, applied: Boolean(apply), children: read.children, created };
};

const childLine = (child, index, created) => {
  const id = created[index] ? `#${created[index].id} ` : '';
  return `  ${id}${child.title} (${child.points} pts, ${child.needs || 'standard'}) files: ${filesOf(child).join(', ')} acceptance: ${child.acceptance}`;
};

/** The text card for a valid plan: what was created, or what --apply would create. */
export const formatPlan = (plan) => {
  const head = plan.applied
    ? `\x1b[32m✔\x1b[0m Created ${plan.created.length} child task(s) under #${plan.parentId}:`
    : `\x1b[34mℹ\x1b[0m Dry run: ${plan.children.length} child task(s) would be created under #${plan.parentId}. Run again with --apply to create them.`;
  const lines = plan.children.map((child, index) => childLine(child, index, plan.created));
  return `${[head, ...lines].join('\n')}\n`;
};
