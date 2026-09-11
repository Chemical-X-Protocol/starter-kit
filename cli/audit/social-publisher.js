import { spawnSync } from 'node:child_process';

export const DISCUSSION_CATEGORY = 'npx chemx audit';
export const DISCUSSION_CATEGORY_SLUG = 'npx-chemx-audit';

export const findMatchedCategory = (categories, categoryName) => {
  const exactName = categories.find((c) => c.name === categoryName);
  if (exactName) return exactName;

  const exactSlug = categories.find((c) => c.slug === categoryName);
  if (exactSlug) return exactSlug;

  const defaultSlug = categories.find((c) => c.slug === DISCUSSION_CATEGORY_SLUG);
  if (defaultSlug) return defaultSlug;

  const targetLower = categoryName.toLowerCase();
  const lowerName = categories.find((c) => c.name.toLowerCase() === targetLower);
  if (lowerName) return lowerName;

  const lowerSlug = categories.find((c) => c.slug.toLowerCase() === targetLower);
  if (lowerSlug) return lowerSlug;

  const chemxName = categories.find((c) => c.name.toLowerCase().includes('chemx'));
  if (chemxName) return chemxName;

  const chemxSlug = categories.find((c) => c.slug.toLowerCase().includes('chemx'));
  if (chemxSlug) return chemxSlug;

  const auditName = categories.find((c) => c.name.toLowerCase().includes('audit'));
  if (auditName) return auditName;

  const auditSlug = categories.find((c) => c.slug.toLowerCase().includes('audit'));
  if (auditSlug) return auditSlug;

  const generalName = categories.find((c) => c.name.toLowerCase().includes('general'));
  if (generalName) return generalName;

  return categories[0];
};

export const publishDiscussionViaHttp = async (token, repo, title, body, categoryName = DISCUSSION_CATEGORY) => {
  if (!token) return { success: false, url: null, error: 'No GitHub token provided' };

  const [owner, name] = repo.split('/');
  if (!owner || !name) return { success: false, url: null, error: `Invalid repository format: ${repo}` };

  try {
    const metaQuery = `
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          discussionCategories(first: 25) {
            nodes {
              id
              name
              slug
              emoji
            }
          }
        }
      }
    `;

    const metaRes = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Chemical-X-Audit-CLI'
      },
      body: JSON.stringify({ query: metaQuery, variables: { owner, name } })
    });

    const metaJson = await metaRes.json();
    if (metaJson.errors) {
      return { success: false, url: null, error: metaJson.errors[0]?.message || 'GraphQL error fetching categories' };
    }

    const repositoryId = metaJson.data?.repository?.id;
    const categories = metaJson.data?.repository?.discussionCategories?.nodes || [];

    if (!repositoryId || categories.length === 0) {
      return { success: false, url: null, error: `Repository ${repo} has no discussions enabled` };
    }

    const matchedCat = findMatchedCategory(categories, categoryName);

    const mutation = `
      mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion {
            url
          }
        }
      }
    `;

    const postRes = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Chemical-X-Audit-CLI'
      },
      body: JSON.stringify({
        query: mutation,
        variables: { repositoryId, categoryId: matchedCat.id, title, body }
      })
    });

    const postJson = await postRes.json();
    if (postJson.errors) {
      return { success: false, url: null, error: postJson.errors[0]?.message || 'Failed creating discussion' };
    }

    const url = postJson.data?.createDiscussion?.discussion?.url;
    return { success: Boolean(url), url: url || null, error: null };
  } catch (err) {
    return { success: false, url: null, error: err.message };
  }
};

export const publishDiscussionViaGh = (repo, title, body, category = DISCUSSION_CATEGORY) => {
  try {
    let res = spawnSync(
      'gh',
      ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', category],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (res.status === 0) {
      return { success: true, url: (res.stdout || '').trim(), error: null };
    }

    const errText = (res.stderr || '').trim();

    // Fallback 1: Try category slug (e.g. 'npx-chemx-audit')
    if (errText.includes('category') && category !== DISCUSSION_CATEGORY_SLUG) {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', DISCUSSION_CATEGORY_SLUG],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    // Fallback 2: Try 'Audits'
    if (errText.includes('category') && category !== 'Audits') {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', 'Audits'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    // Fallback 3: Try 'General' category
    if (errText.includes('category')) {
      res = spawnSync(
        'gh',
        ['discussion', 'create', '-R', repo, '--title', title, '--body', body, '--category', 'General'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      if (res.status === 0) {
        return { success: true, url: (res.stdout || '').trim(), error: null };
      }
    }

    return { success: false, url: null, error: errText };
  } catch (err) {
    return { success: false, url: null, error: err.message };
  }
};

export const publishDiscussion = async (repo, title, body, category = DISCUSSION_CATEGORY) => {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) {
    const httpResult = await publishDiscussionViaHttp(envToken, repo, title, body, category);
    if (httpResult.success) {
      return httpResult;
    }
  }

  return publishDiscussionViaGh(repo, title, body, category);
};
