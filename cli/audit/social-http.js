import {
  DISCUSSION_CATEGORY,
  DISCUSSION_CATEGORY_SLUG
} from './social-constants.js';

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
  if (!token) return { success: false, url: null, id: null, number: null, error: 'No GitHub token provided' };

  const [owner, name] = repo.split('/');
  const isValidRepo = Boolean(owner && name);
  if (!isValidRepo) return { success: false, url: null, id: null, number: null, error: `Invalid repository format: ${repo}` };

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
    const hasMetaErrors = Boolean(metaJson.errors);
    if (hasMetaErrors) {
      return { success: false, url: null, id: null, number: null, error: metaJson.errors[0]?.message || 'GraphQL error fetching categories' };
    }

    const repository = metaJson.data?.repository;
    const repositoryId = repository?.id;
    const categories = repository?.discussionCategories?.nodes || [];

    const hasDiscussions = Boolean(repositoryId && categories.length > 0);
    if (!hasDiscussions) {
      return { success: false, url: null, id: null, number: null, error: `Repository ${repo} has no discussions enabled` };
    }

    const matchedCat = findMatchedCategory(categories, categoryName);

    const mutation = `
      mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
          discussion {
            id
            number
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
    const hasPostErrors = Boolean(postJson.errors);
    if (hasPostErrors) {
      return { success: false, url: null, id: null, number: null, error: postJson.errors[0]?.message || 'Failed creating discussion' };
    }

    const disc = postJson.data?.createDiscussion?.discussion;
    const url = disc?.url;
    return {
      success: Boolean(url),
      url: url || null,
      id: disc?.id || null,
      number: disc?.number || null,
      error: null
    };
  } catch (err) {
    return { success: false, url: null, id: null, number: null, error: err.message };
  }
};

export const viewDiscussionViaHttp = async (token, repo, discussionNumber) => {
  const [owner, name] = repo.split('/');
  const isValidRepo = Boolean(owner && name);
  if (!isValidRepo) return null;

  try {
    const query = `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          discussion(number: $number) {
            id
            number
            title
            body
            url
          }
        }
      }
    `;
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Chemical-X-Audit-CLI'
      },
      body: JSON.stringify({ query, variables: { owner, name, number: Number(discussionNumber) } })
    });
    const json = await res.json();
    return json.data?.repository?.discussion || null;
  } catch {
    return null;
  }
};

export const postDiscussionCommentViaHttp = async (token, discussionId, commentBody) => {
  try {
    const mutation = `
      mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment {
            id
            url
          }
        }
      }
    `;
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Chemical-X-Audit-CLI'
      },
      body: JSON.stringify({ query: mutation, variables: { discussionId, body: commentBody } })
    });
    const json = await res.json();
    const addedComment = json.data?.addDiscussionComment;
    return Boolean(addedComment?.comment?.id);
  } catch {
    return false;
  }
};

export const editDiscussionViaHttp = async (token, discussionId, title, body) => {
  try {
    const mutation = `
      mutation($discussionId: ID!, $title: String!, $body: String!) {
        updateDiscussion(input: { discussionId: $discussionId, title: $title, body: $body }) {
          discussion {
            id
            number
            url
            title
          }
        }
      }
    `;
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Chemical-X-Audit-CLI'
      },
      body: JSON.stringify({ query: mutation, variables: { discussionId, title, body } })
    });
    const json = await res.json();
    const updated = json.data?.updateDiscussion;
    return Boolean(updated?.discussion?.id);
  } catch {
    return false;
  }
};
